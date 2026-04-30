const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const queueService = require("../services/queue.service");
const rateLimitService = require("../services/rateLimit.service");
const { formatRemainingDelay } = require("../utils/time.utils");

/**
 * Vérifie que le socket a accès à l'événement :
 * - soit comme DJ propriétaire
 * - soit comme modérateur (session.modAccess.eventId === eventId)
 * Retourne { authorized, role } — role: 'dj' | 'moderator' | null
 */
async function verifyEventAccess(socket, eventId) {
  if (!eventId) return { authorized: false, role: null };
  const session = socket.request?.session;

  // Vérification DJ
  const djId = session?.djId;
  if (djId) {
    const [rows] = await db.query(
      "SELECT id FROM events WHERE id = ? AND dj_id = ?",
      [eventId, djId],
    );
    if (rows.length > 0) return { authorized: true, role: "dj" };
  }

  // Vérification modérateur
  const modAccess = session?.modAccess;
  if (modAccess?.eventId === eventId) {
    return { authorized: true, role: "moderator" };
  }

  socket.emit("error", { message: "Accès refusé" });
  return { authorized: false, role: null };
}

/** Alias pour les handlers qui n'ont besoin que du booléen */
async function verifyDjOwnsEvent(socket, eventId) {
  const { authorized } = await verifyEventAccess(socket, eventId);
  return authorized;
}

/**
 * Vérifie que le socket a accès à l'event auquel appartient la demande.
 * Retourne la row { event_id, socket_id } ou null.
 */
async function verifyDjOwnsRequest(socket, requestId) {
  if (!requestId) return null;
  const session = socket.request?.session;

  // DJ check
  const djId = session?.djId;
  if (djId) {
    const [rows] = await db.query(
      `SELECT r.event_id, r.socket_id
         FROM requests r
         JOIN events e ON r.event_id = e.id
        WHERE r.id = ? AND e.dj_id = ?`,
      [requestId, djId],
    );
    if (rows.length > 0) return rows[0];
  }

  // Modérateur check
  const modEventId = session?.modAccess?.eventId;
  if (modEventId) {
    const [rows] = await db.query(
      `SELECT r.event_id, r.socket_id
         FROM requests r
        WHERE r.id = ? AND r.event_id = ?`,
      [requestId, modEventId],
    );
    if (rows.length > 0) return rows[0];
  }

  return null;
}

// Stockage en mémoire du dernier "now-playing" par événement
// Permet d'envoyer l'état courant aux nouveaux connectés (écran grand format, page user)
const nowPlayingCache = new Map(); // eventId → payload

/** Refus récents éligibles à « Annuler » (fenêtre courte, mémoire processus) */
const recentRejectUndo = new Map(); // requestId → rejectedAt (ms)
const UNDO_REJECT_WINDOW_MS = 8000;

function setupSocketHandlers(io) {
  io.on("connection", (socket) => {
    // Rejoindre un événement
    // data peut être un string (DJ/QR) ou un objet { eventId, clientId } (user page)
    socket.on("join-event", async (data) => {
      const eventId  = typeof data === "object" ? data.eventId  : data;
      const clientId = typeof data === "object" && data.clientId ? data.clientId : socket.id;

      socket.join(eventId);
      socket.clientId = clientId; // stocker pour request-song
      socket.eventId  = eventId;  // stocker pour disconnect

      // Diffuser le compteur de spectateurs à toute la room (y compris DJ)
      const roomSize = io.sockets.adapter.rooms.get(eventId)?.size || 1;
      io.to(eventId).emit("spectator-count", { count: roomSize });

      // Envoyer immédiatement l'état "now-playing" en cache si disponible
      const cached = nowPlayingCache.get(eventId);
      if (cached) {
        socket.emit("now-playing", cached);
      }

      // Vérifier si ce client est banni (persistance après refresh)
      try {
        const [banRows] = await db.query(
          "SELECT banned_until FROM user_bans WHERE event_id = ? AND client_id = ?",
          [eventId, clientId],
        );
        if (banRows.length > 0) {
          const ban = banRows[0];
          if (ban.banned_until === null) {
            // Ban permanent
            socket.emit("you-are-banned", { permanent: true, remainingMs: null });
          } else if (Date.now() < ban.banned_until) {
            // Ban temporaire encore actif
            socket.emit("you-are-banned", {
              permanent: false,
              remainingMs: ban.banned_until - Date.now(),
            });
          } else {
            // Ban expiré → nettoyer
            await db.query(
              "DELETE FROM user_bans WHERE event_id = ? AND client_id = ?",
              [eventId, clientId],
            );
          }
        }
      } catch (err) {
        console.error("Erreur vérification ban join-event:", err);
      }

      // Envoyer le statut du rate limit
      try {
        const rateLimitStatus = await rateLimitService.checkRateLimit(
          clientId,
          eventId,
        );
        socket.emit("rate-limit-status", rateLimitStatus);
      } catch (error) {
        console.error("Erreur rate limit status:", error);
      }
    });

    // Demander une chanson
    socket.on("request-song", async (data) => {
      const { eventId, songData, userName, clientId: dataClientId } = data;
      // Priorité : clientId envoyé dans le message > clientId du join > socket.id
      const clientId  = dataClientId || socket.clientId || socket.id;
      const requestId = uuidv4();

      // Validation des champs obligatoires
      if (
        !songData ||
        typeof songData.name   !== "string" || !songData.name.trim()  ||
        typeof songData.artist !== "string" || !songData.artist.trim() ||
        typeof songData.uri    !== "string" || !/^spotify:track:[A-Za-z0-9]+$/.test(songData.uri)
      ) {
        socket.emit("request-error", { message: "Données de chanson invalides" });
        return;
      }

      // Limites de longueur pour éviter les injections de données volumineuses
      const safeName   = songData.name.trim().slice(0, 255);
      const safeArtist = songData.artist.trim().slice(0, 255);
      const safeAlbum  = (songData.album || "").slice(0, 255);
      const safeUser   = (userName || "Anonyme").trim().slice(0, 100);
      const safeImage  = typeof songData.image === "string" && songData.image.startsWith("https://")
        ? songData.image.slice(0, 512)
        : null;
      const safePreview = typeof songData.preview_url === "string" && songData.preview_url.startsWith("https://")
        ? songData.preview_url.slice(0, 512)
        : null;
      const safeDuration = Number.isInteger(songData.duration_ms) && songData.duration_ms > 0
        ? songData.duration_ms
        : null;

      try {
        // Vérifier si l'utilisateur est banni
        const [banRows] = await db.query(
          "SELECT banned_until FROM user_bans WHERE event_id = ? AND client_id = ?",
          [eventId, clientId],
        );
        if (banRows.length > 0) {
          const ban = banRows[0];
          if (ban.banned_until === null) {
            // Ban permanent pour la soirée
            socket.emit("request-error", {
              type: "banned",
              message: "Tu ne peux plus proposer de musique pour cette soirée.",
            });
            return;
          } else if (Date.now() < ban.banned_until) {
            // Ban temporaire encore actif
            const remainingMs = ban.banned_until - Date.now();
            const mins = Math.ceil(remainingMs / 60000);
            socket.emit("request-error", {
              type: "banned",
              message: `Tu es bloqué pendant encore ${mins} minute${mins > 1 ? "s" : ""}.`,
              remainingMs,
            });
            return;
          } else {
            // Ban expiré → supprimer
            await db.query(
              "DELETE FROM user_bans WHERE event_id = ? AND client_id = ?",
              [eventId, clientId],
            );
          }
        }

        // Vérifier le rate limit
        const rateLimitCheck = await rateLimitService.checkRateLimit(
          clientId,
          eventId,
        );

        if (!rateLimitCheck.allowed) {
          socket.emit("request-error", {
            type: "rate-limit",
            message: `Limite atteinte. Réessaie dans ${formatRemainingDelay(rateLimitCheck.remainingMs)}.`,
          });
          return;
        }

        // Récupérer les paramètres de l'événement
        const [eventRows] = await db.query(
          "SELECT allow_duplicates, auto_accept_enabled, repeat_cooldown_minutes FROM events WHERE id = ?",
          [eventId],
        );

        if (eventRows.length === 0) {
          socket.emit("request-error", { message: "Événement non trouvé" });
          return;
        }

        const event = eventRows[0];

        // Vérifier les doublons si non autorisés
        if (!event.allow_duplicates) {
          const duplicate = await queueService.checkDuplicate(
            eventId,
            songData.uri,
          );

          if (duplicate.isDuplicate) {
            const location =
              duplicate.location === "queue"
                ? "la queue"
                : "les demandes en attente";
            socket.emit("request-error", {
              type: "duplicate",
              message: `Cette chanson est déjà dans ${location}`,
            });
            return;
          }
        }

        const cooldownMin = Number(event.repeat_cooldown_minutes) || 0;
        if (cooldownMin > 0) {
          const [recentPlayed] = await db.query(
            `SELECT played_at FROM requests
             WHERE event_id = ? AND spotify_uri = ? AND status = 'played' AND played_at IS NOT NULL
             ORDER BY played_at DESC LIMIT 1`,
            [eventId, songData.uri],
          );
          if (recentPlayed.length > 0) {
            const playedAt = new Date(recentPlayed[0].played_at).getTime();
            const elapsedMin = (Date.now() - playedAt) / 60000;
            if (elapsedMin < cooldownMin) {
              const waitMin = Math.max(1, Math.ceil(cooldownMin - elapsedMin));
              socket.emit("request-error", {
                type: "repeat-cooldown",
                message: `Ce morceau a déjà été joué récemment. Tu pourras le reproposer dans environ ${waitMin} min.`,
              });
              return;
            }
          }
        }

        // Déterminer le statut initial
        const status = event.auto_accept_enabled ? "accepted" : "pending";
        let queuePosition = null;

        if (status === "accepted") {
          queuePosition = await queueService.getNextQueuePosition(eventId);
        }

        // Insérer la demande (champs validés et tronqués)
        await db.query(
          `INSERT INTO requests 
      (id, event_id, socket_id, client_id, user_name, song_name, artist, spotify_uri, 
       image_url, preview_url, duration_ms, status, queue_position) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            requestId,
            eventId,
            socket.id,
            clientId,
            safeUser,
            safeName,
            safeArtist,
            songData.uri,
            safeImage,
            safePreview,
            safeDuration,
            status,
            queuePosition,
          ],
        );

        // Incrémenter le rate limit
        await rateLimitService.incrementRateLimit(clientId);

        // Récupérer le nouveau statut
        const newRateLimitStatus = await rateLimitService.checkRateLimit(
          clientId,
          eventId,
        );

        // Notifier l'utilisateur de la création
        socket.emit("request-created", {
          requestId,
          songName: safeName,
          artist:   safeArtist,
          image:    safeImage,
          status,
          rateLimitStatus: newRateLimitStatus,
        });

        if (status === "accepted") {
          // Notifier l'utilisateur de l'acceptation
          socket.emit("your-request-accepted", {
            requestId,
            position: queuePosition,
          });

          // Mettre à jour la queue pour tous (DJ + users)
          const queue = await queueService.getQueueWithVotes(eventId);
          io.to(eventId).emit("queue-updated", { queue });

          // Notifier aussi le DJ via request-accepted
          io.to(eventId).emit("request-accepted", { requestId });
        } else {
          const request = await queueService.getRequestWithVotes(requestId);
          io.to(eventId).emit("new-request", request);
        }
      } catch (error) {
        console.error("❌ Erreur request-song:", error);
        socket.emit("request-error", { message: "Erreur lors de la demande" });
      }
    });

    // Voter pour une chanson
    socket.on("vote", async (data) => {
      const { requestId, voteType } = data;

      if (!["up", "down"].includes(voteType)) {
        return;
      }

      try {
        // Vérifier que la chanson existe et est acceptée
        const [requestRows] = await db.query(
          "SELECT event_id, status FROM requests WHERE id = ?",
          [requestId],
        );

        if (requestRows.length === 0 || requestRows[0].status !== "accepted") {
          return;
        }

        const eventId = requestRows[0].event_id;

        // Vérifier que les votes sont activés
        const [eventRows] = await db.query(
          "SELECT votes_enabled FROM events WHERE id = ?",
          [eventId],
        );

        if (eventRows.length === 0 || !eventRows[0].votes_enabled) {
          socket.emit("vote-error", { message: "Les votes sont désactivés" });
          return;
        }

        // Vérifier si l'utilisateur a déjà voté
        const [existingVotes] = await db.query(
          "SELECT id, vote_type FROM votes WHERE request_id = ? AND socket_id = ?",
          [requestId, socket.id],
        );

        if (existingVotes.length > 0) {
          const existingVote = existingVotes[0];

          if (existingVote.vote_type === voteType) {
            // Retirer le vote
            await db.query("DELETE FROM votes WHERE id = ?", [existingVote.id]);
          } else {
            // Changer le vote
            await db.query("UPDATE votes SET vote_type = ? WHERE id = ?", [
              voteType,
              existingVote.id,
            ]);
          }
        } else {
          // Nouveau vote
          await db.query(
            "INSERT INTO votes (request_id, socket_id, vote_type) VALUES (?, ?, ?)",
            [requestId, socket.id, voteType],
          );
        }

        // Récupérer les votes mis à jour
        const [upvotes] = await db.query(
          'SELECT COUNT(*) as count FROM votes WHERE request_id = ? AND vote_type = "up"',
          [requestId],
        );

        const [downvotes] = await db.query(
          'SELECT COUNT(*) as count FROM votes WHERE request_id = ? AND vote_type = "down"',
          [requestId],
        );

        // Notifier tous les clients
        io.to(eventId).emit("vote-updated", {
          requestId,
          upvotes: upvotes[0].count,
          downvotes: downvotes[0].count,
        });
      } catch (error) {
        console.error("Erreur vote:", error);
        socket.emit("vote-error", { message: "Erreur lors du vote" });
      }
    });

    // Accepter une demande (DJ)
    socket.on("accept-request", async (data) => {
      const { requestId } = data;

      try {
        const reqRow = await verifyDjOwnsRequest(socket, requestId);
        if (!reqRow) return;

        const eventId = reqRow.event_id;
        const newPosition = await queueService.getNextQueuePosition(eventId);

        await db.query(
          "UPDATE requests SET status = ?, queue_position = ? WHERE id = ?",
          ["accepted", newPosition, requestId],
        );

        const queue = await queueService.getQueueWithVotes(eventId);

        io.to(eventId).emit("request-accepted", { requestId });
        io.to(eventId).emit("queue-updated", { queue });
        io.to(reqRow.socket_id).emit("your-request-accepted", {
          requestId,
          position: newPosition,
        });
      } catch (error) {
        console.error("Erreur accept-request:", error);
      }
    });

    // Refuser une demande (DJ)
    socket.on("reject-request", async (data) => {
      const { requestId } = data;

      try {
        const reqRow = await verifyDjOwnsRequest(socket, requestId);
        if (!reqRow) return;

        await db.query("UPDATE requests SET status = ? WHERE id = ?", [
          "rejected",
          requestId,
        ]);

        recentRejectUndo.set(requestId, Date.now());
        setTimeout(() => recentRejectUndo.delete(requestId), UNDO_REJECT_WINDOW_MS);

        io.to(reqRow.event_id).emit("request-rejected", { requestId });
        io.to(reqRow.socket_id).emit("your-request-rejected", { requestId });
      } catch (error) {
        console.error("Erreur reject-request:", error);
      }
    });

    // Annuler un refus récent (remettre en pending)
    socket.on("undo-reject-request", async (data) => {
      const { requestId } = data || {};
      if (!requestId) return;

      const ts = recentRejectUndo.get(requestId);
      if (!ts || Date.now() - ts > UNDO_REJECT_WINDOW_MS) return;

      try {
        const reqRow = await verifyDjOwnsRequest(socket, requestId);
        if (!reqRow) return;

        const [st] = await db.query("SELECT status FROM requests WHERE id = ?", [requestId]);
        if (st.length === 0 || st[0].status !== "rejected") return;

        await db.query(
          "UPDATE requests SET status = 'pending', queue_position = NULL WHERE id = ?",
          [requestId],
        );
        recentRejectUndo.delete(requestId);

        const request = await queueService.getRequestWithVotes(requestId);
        io.to(reqRow.event_id).emit("reject-undone", { requestId });
        io.to(reqRow.event_id).emit("new-request", request);
        if (reqRow.socket_id) {
          io.to(reqRow.socket_id).emit("your-request-pending-again", { requestId });
        }
      } catch (error) {
        console.error("Erreur undo-reject-request:", error);
      }
    });

    // Accepter toutes les demandes en attente
    socket.on("accept-all-pending", async (data) => {
      const { eventId } = data || {};
      if (!eventId) return;
      if (!(await verifyDjOwnsEvent(socket, eventId))) return;

      try {
        const [pending] = await db.query(
          `SELECT id, socket_id FROM requests
           WHERE event_id = ? AND status = 'pending' ORDER BY created_at ASC`,
          [eventId],
        );

        for (const row of pending) {
          const newPosition = await queueService.getNextQueuePosition(eventId);
          const [upd] = await db.query(
            `UPDATE requests SET status = 'accepted', queue_position = ?
             WHERE id = ? AND status = 'pending'`,
            [newPosition, row.id],
          );
          if (upd.affectedRows) {
            io.to(eventId).emit("request-accepted", { requestId: row.id });
            if (row.socket_id) {
              io.to(row.socket_id).emit("your-request-accepted", {
                requestId: row.id,
                position:  newPosition,
              });
            }
          }
        }

        const queue = await queueService.getQueueWithVotes(eventId);
        io.to(eventId).emit("queue-updated", { queue });
      } catch (error) {
        console.error("Erreur accept-all-pending:", error);
      }
    });

    // Refuser toutes les demandes en attente (pas d’undo groupé)
    socket.on("reject-all-pending", async (data) => {
      const { eventId } = data || {};
      if (!eventId) return;
      if (!(await verifyDjOwnsEvent(socket, eventId))) return;

      try {
        const [pending] = await db.query(
          `SELECT id, socket_id FROM requests WHERE event_id = ? AND status = 'pending'`,
          [eventId],
        );

        for (const row of pending) {
          await db.query("UPDATE requests SET status = 'rejected' WHERE id = ?", [row.id]);
          io.to(eventId).emit("request-rejected", { requestId: row.id });
          if (row.socket_id) {
            io.to(row.socket_id).emit("your-request-rejected", { requestId: row.id });
          }
        }
      } catch (error) {
        console.error("Erreur reject-all-pending:", error);
      }
    });

    // Réorganiser la queue (DJ)
    socket.on("reorder-queue", async (data) => {
      const { eventId, newQueue } = data;

      try {
        if (!(await verifyDjOwnsEvent(socket, eventId))) return;

        if (!Array.isArray(newQueue)) return;
        for (let i = 0; i < newQueue.length; i++) {
          await db.query(
            "UPDATE requests SET queue_position = ? WHERE id = ? AND event_id = ?",
            [i + 1, newQueue[i].id, eventId],
          );
        }

        const queue = await queueService.getQueueWithVotes(eventId);
        io.to(eventId).emit("queue-updated", { queue });
      } catch (error) {
        console.error("Erreur reorder-queue:", error);
      }
    });

    // Marquer comme jouée (DJ)
    socket.on("mark-played", async (data) => {
      const { eventId, requestId } = data;

      try {
        if (!(await verifyDjOwnsEvent(socket, eventId))) return;

        await db.query(
          "UPDATE requests SET status = ?, played_at = NOW(), queue_position = NULL WHERE id = ? AND event_id = ?",
          ["played", requestId, eventId],
        );

        const queue = await queueService.getQueueWithVotes(eventId);
        io.to(eventId).emit("queue-updated", { queue });
      } catch (error) {
        console.error("Erreur mark-played:", error);
      }
    });

    // Diffuser le morceau en cours aux invités (DJ → tous)
    socket.on("broadcast-now-playing", async (data) => {
      const { eventId } = data;
      if (!eventId) return;
      if (!(await verifyDjOwnsEvent(socket, eventId))) return;
      // Mettre en cache pour les nouveaux connectés
      if (data.track) {
        nowPlayingCache.set(eventId, data);
      } else {
        nowPlayingCache.delete(eventId);
      }
      socket.to(eventId).emit("now-playing", data);
    });

    // Message du DJ vers tous les invités
    socket.on("dj-message", async (data) => {
      const { eventId, message } = data;
      if (!eventId || !message?.trim()) return;
      if (!(await verifyDjOwnsEvent(socket, eventId))) return;
      socket.to(eventId).emit("dj-message", { message: message.trim() });
    });

    // ── Système de ban ──────────────────────────────────────────────────────

    // Bannir un utilisateur (DJ)
    // duration: nombre de minutes (0 = toute la soirée)
    socket.on("ban-user", async (data) => {
      const { eventId, requestId, duration } = data;

      try {
        if (!(await verifyDjOwnsEvent(socket, eventId))) return;

        // Récupérer le clientId et userName depuis la demande
        const [reqRows] = await db.query(
          "SELECT client_id, user_name FROM requests WHERE id = ? AND event_id = ?",
          [requestId, eventId],
        );
        if (reqRows.length === 0) return;

        const { client_id: clientId, user_name: userName } = reqRows[0];
        if (!clientId) return;

        const bannedUntil = duration > 0 ? Date.now() + duration * 60 * 1000 : null;

        await db.query(
          `INSERT INTO user_bans (event_id, client_id, user_name, banned_until)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             banned_until = VALUES(banned_until),
             user_name    = VALUES(user_name)`,
          [eventId, clientId, userName || "Anonyme", bannedUntil],
        );

        // ── Supprimer toutes les demandes en attente du banni ──
        const [pendingRows] = await db.query(
          "SELECT id FROM requests WHERE event_id = ? AND client_id = ? AND status = 'pending'",
          [eventId, clientId],
        );

        if (pendingRows.length > 0) {
          const ids = pendingRows.map((r) => r.id);
          await db.query(
            `UPDATE requests SET status = 'rejected' WHERE id IN (${ids.map(() => "?").join(",")})`,
            ids,
          );

          // Notifier la room que ces demandes sont rejetées
          for (const r of pendingRows) {
            io.to(eventId).emit("request-rejected", { requestId: r.id });
          }
        }

        // ── Queue mise à jour pour tous ──
        const queue = await queueService.getQueueWithVotes(eventId);
        io.to(eventId).emit("queue-updated", { queue });

        // ── Notifier le client banni s'il est encore connecté ──
        for (const [, s] of io.of("/").sockets) {
          if (s.clientId === clientId) {
            s.emit("you-are-banned", {
              permanent: bannedUntil === null,
              remainingMs: bannedUntil ? bannedUntil - Date.now() : null,
              cancelledRequestIds: pendingRows.map((r) => r.id),
            });
            break;
          }
        }

        // ── Envoyer la liste mise à jour au DJ ──
        const [bans] = await db.query(
          "SELECT client_id, user_name, banned_until FROM user_bans WHERE event_id = ? ORDER BY user_name ASC",
          [eventId],
        );
        socket.emit("banned-users-updated", { bans });
      } catch (error) {
        console.error("Erreur ban-user:", error);
      }
    });

    // Débannir un utilisateur (DJ)
    socket.on("unban-user", async (data) => {
      const { eventId, clientId } = data;

      try {
        if (!(await verifyDjOwnsEvent(socket, eventId))) return;

        await db.query(
          "DELETE FROM user_bans WHERE event_id = ? AND client_id = ?",
          [eventId, clientId],
        );

        const [bans] = await db.query(
          "SELECT client_id, user_name, banned_until FROM user_bans WHERE event_id = ? ORDER BY user_name ASC",
          [eventId],
        );
        socket.emit("banned-users-updated", { bans });
      } catch (error) {
        console.error("Erreur unban-user:", error);
      }
    });

    // Récupérer la liste des utilisateurs bannis (DJ)
    socket.on("get-banned-users", async (data) => {
      const { eventId } = data;
      try {
        if (!(await verifyDjOwnsEvent(socket, eventId))) return;

        const [bans] = await db.query(
          "SELECT client_id, user_name, banned_until FROM user_bans WHERE event_id = ? ORDER BY user_name ASC",
          [eventId],
        );
        socket.emit("banned-users-updated", { bans });
      } catch (error) {
        console.error("Erreur get-banned-users:", error);
      }
    });

    // Mettre à jour les paramètres de l'événement (DJ)
    socket.on("update-event-settings", async (data) => {
      const {
        eventId,
        votesEnabled,
        autoAcceptEnabled,
        fallbackPlaylistUri,
        donationEnabled,
        donationRequired,
        donationAmount,
        donationLink,
        donationMessage,
        repeatCooldownMinutes,
        projectionVisualsEnabled,
        projectionVisualsMode,
        projectionVisualsAutoPerTrack,
      } = data;

      try {
        if (!(await verifyDjOwnsEvent(socket, eventId))) return;

        // Construire la requête SQL dynamiquement
        const updates = [];
        const values = [];

        if (votesEnabled !== undefined) {
          updates.push("votes_enabled = ?");
          values.push(votesEnabled ? 1 : 0);
        }

        if (autoAcceptEnabled !== undefined) {
          updates.push("auto_accept_enabled = ?");
          values.push(autoAcceptEnabled ? 1 : 0);
        }

        if (fallbackPlaylistUri !== undefined) {
          updates.push("fallback_playlist_uri = ?");
          values.push(fallbackPlaylistUri || null);
        }

        if (donationEnabled !== undefined) {
          updates.push("donation_enabled = ?");
          values.push(donationEnabled ? 1 : 0);
        }

        if (donationRequired !== undefined) {
          updates.push("donation_required = ?");
          values.push(donationRequired ? 1 : 0);
        }

        if (donationAmount !== undefined) {
          const amount = parseFloat(donationAmount);
          if (!isNaN(amount) && amount >= 0.5 && amount <= 50) {
            updates.push("donation_amount = ?");
            values.push(amount);
          }
        }

        if (donationLink !== undefined) {
          const link = (donationLink || "").trim();
          // Accepter uniquement des URLs HTTPS ou des chaînes vides
          const safeLink = /^https:\/\/.{5,}/.test(link) ? link.slice(0, 500) : null;
          updates.push("donation_link = ?");
          values.push(safeLink);
        }

        if (donationMessage !== undefined) {
          updates.push("donation_message = ?");
          values.push((donationMessage || "").trim().slice(0, 500) || null);
        }

        if (repeatCooldownMinutes !== undefined) {
          const n = parseInt(String(repeatCooldownMinutes), 10);
          if (!Number.isNaN(n) && n >= 0 && n <= 240) {
            updates.push("repeat_cooldown_minutes = ?");
            values.push(n);
          }
        }

        if (projectionVisualsEnabled !== undefined) {
          updates.push("projection_visuals_enabled = ?");
          values.push(projectionVisualsEnabled ? 1 : 0);
        }

        if (projectionVisualsMode !== undefined) {
          const mode = String(projectionVisualsMode || "").trim().toLowerCase();
          if (["aurora", "pulse", "strobe", "spectrum", "nebula", "laser", "vortex", "party"].includes(mode)) {
            updates.push("projection_visuals_mode = ?");
            values.push(mode);
          }
        }

        if (projectionVisualsAutoPerTrack !== undefined) {
          updates.push("projection_visuals_auto_per_track = ?");
          values.push(projectionVisualsAutoPerTrack ? 1 : 0);
        }

        if (updates.length > 0) {
          values.push(eventId);
          await db.query(
            `UPDATE events SET ${updates.join(", ")} WHERE id = ?`,
            values,
          );

          // Notifier TOUS les clients (DJ + users)
          io.to(eventId).emit("event-settings-updated", {
            votesEnabled,
            autoAcceptEnabled,
            donationEnabled,
            donationRequired,
            donationAmount,
            donationLink: donationLink ? (donationLink || "").trim().slice(0, 500) : undefined,
            donationMessage: donationMessage ? (donationMessage || "").trim().slice(0, 500) : undefined,
            repeatCooldownMinutes: repeatCooldownMinutes !== undefined
              ? parseInt(String(repeatCooldownMinutes), 10)
              : undefined,
            projectionVisualsEnabled: projectionVisualsEnabled !== undefined
              ? !!projectionVisualsEnabled
              : undefined,
            projectionVisualsMode: projectionVisualsMode !== undefined
              ? String(projectionVisualsMode || "").trim().toLowerCase()
              : undefined,
            projectionVisualsAutoPerTrack: projectionVisualsAutoPerTrack !== undefined
              ? !!projectionVisualsAutoPerTrack
              : undefined,
          });
        }
      } catch (error) {
        console.error("❌ Erreur update-event-settings:", error);
      }
    });

    // Mise à jour du compteur spectateurs à la déconnexion
    socket.on("disconnect", () => {
      if (socket.eventId) {
        // Attendre que le socket soit retiré de la room avant de compter
        setTimeout(() => {
          const size = io.sockets.adapter.rooms.get(socket.eventId)?.size || 0;
          io.to(socket.eventId).emit("spectator-count", { count: size });
        }, 200);
      }
    });
  });
}

module.exports = setupSocketHandlers;
module.exports.clearNowPlayingCache = (eventId) => nowPlayingCache.delete(eventId);
