const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const queueService = require("../services/queue.service");
const rateLimitService = require("../services/rateLimit.service");

function setupSocketHandlers(io) {
  io.on("connection", (socket) => {
    // Rejoindre un événement
    socket.on("join-event", async (eventId) => {
      socket.join(eventId);

      // Envoyer le statut du rate limit
      try {
        const rateLimitStatus = await rateLimitService.checkRateLimit(
          socket.id,
          eventId,
        );
        socket.emit("rate-limit-status", rateLimitStatus);
      } catch (error) {
        console.error("Erreur rate limit status:", error);
      }
    });

    // Demander une chanson
    socket.on("request-song", async (data) => {
      const { eventId, songData, userName } = data;
      const requestId = uuidv4();

      try {
        // Vérifier le rate limit
        const rateLimitCheck = await rateLimitService.checkRateLimit(
          socket.id,
          eventId,
        );

        if (!rateLimitCheck.allowed) {
          socket.emit("request-error", {
            type: "rate-limit",
            message: `Limite atteinte. Réessaie dans ${rateLimitCheck.remainingTime} minutes.`,
          });
          return;
        }

        // Récupérer les paramètres de l'événement
        const [eventRows] = await db.query(
          "SELECT allow_duplicates, auto_accept_enabled FROM events WHERE id = ?",
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

        // Déterminer le statut initial
        const status = event.auto_accept_enabled ? "accepted" : "pending";
        let queuePosition = null;

        if (status === "accepted") {
          queuePosition = await queueService.getNextQueuePosition(eventId);
        }

        // Insérer la demande
        await db.query(
          `INSERT INTO requests 
      (id, event_id, socket_id, user_name, song_name, artist, spotify_uri, 
       image_url, preview_url, status, queue_position) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            requestId,
            eventId,
            socket.id,
            userName || "Anonyme",
            songData.name,
            songData.artist,
            songData.uri,
            songData.image,
            songData.preview || null,
            status,
            queuePosition,
          ],
        );

        // Incrémenter le rate limit
        await rateLimitService.incrementRateLimit(socket.id);

        // Récupérer le nouveau statut
        const newRateLimitStatus = await rateLimitService.checkRateLimit(
          socket.id,
          eventId,
        );

        // Notifier l'utilisateur de la création
        socket.emit("request-created", {
          requestId,
          songName: songData.name,
          artist: songData.artist,
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
        const [reqRows] = await db.query(
          "SELECT event_id, socket_id FROM requests WHERE id = ?",
          [requestId],
        );

        if (reqRows.length === 0) {
          return;
        }

        const eventId = reqRows[0].event_id;
        const newPosition = await queueService.getNextQueuePosition(eventId);

        await db.query(
          "UPDATE requests SET status = ?, queue_position = ? WHERE id = ?",
          ["accepted", newPosition, requestId],
        );

        const queue = await queueService.getQueueWithVotes(eventId);

        io.to(eventId).emit("request-accepted", { requestId });
        io.to(eventId).emit("queue-updated", { queue });
        io.to(reqRows[0].socket_id).emit("your-request-accepted", {
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
        await db.query("UPDATE requests SET status = ? WHERE id = ?", [
          "rejected",
          requestId,
        ]);

        const [reqRows] = await db.query(
          "SELECT event_id, socket_id FROM requests WHERE id = ?",
          [requestId],
        );

        if (reqRows.length > 0) {
          io.to(reqRows[0].event_id).emit("request-rejected", { requestId });
          io.to(reqRows[0].socket_id).emit("your-request-rejected", {
            requestId,
          });
        }
      } catch (error) {
        console.error("Erreur reject-request:", error);
      }
    });

    // Réorganiser la queue (DJ)
    socket.on("reorder-queue", async (data) => {
      const { eventId, newQueue } = data;

      try {
        // Mettre à jour les positions
        for (let i = 0; i < newQueue.length; i++) {
          await db.query(
            "UPDATE requests SET queue_position = ? WHERE id = ?",
            [i + 1, newQueue[i].id],
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
        await db.query(
          "UPDATE requests SET status = ?, played_at = NOW(), queue_position = NULL WHERE id = ?",
          ["played", requestId],
        );

        const queue = await queueService.getQueueWithVotes(eventId);
        io.to(eventId).emit("queue-updated", { queue });
      } catch (error) {
        console.error("Erreur mark-played:", error);
      }
    });

    // Mettre à jour les paramètres de l'événement (DJ)
    socket.on("update-event-settings", async (data) => {
      const { eventId, votesEnabled, autoAcceptEnabled } = data;

      try {
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
          });
        }
      } catch (error) {
        console.error("❌ Erreur update-event-settings:", error);
      }
    });
  });
}

module.exports = setupSocketHandlers;
