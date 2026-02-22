const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true, // the user who will receive this notification
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // who caused this notification
    },
    type: {
      type: String,
      enum: [
        "welcome",
        "friend_request_received",
        "friend_request_accepted",
        "message_received",
        "added_to_group_request",
        "accepted_group_request",
        "removed_from_group",
        "chat_participant_joined",
        "mention",
        "post_reaction",
        "post_comment",
        "system",
      ],
      required: true,
    },
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: false, // for chat-based notifications
    },
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: false,
    },
    text: {
      type: String,
      required: false, // custom message if needed
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
