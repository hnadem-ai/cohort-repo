import { useState, useEffect, useRef } from "react";
import { useFloating, offset, flip, autoUpdate } from "@floating-ui/react";
import reactImg from "../images/reaction-fontcolor.png";
import "./ReactMenu.css";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import EmojiPicker, {EmojiStyle} from "emoji-picker-react";
import { useNavigate } from "react-router-dom";
import {ReactComponent as MyPlusIcon} from '../images/plus-icon.svg';

function getMyReaction(message, userId) {
  if (!message?.reactions || !userId) return null;

  const reaction = message.reactions.find(
    (r) => String(r.userId) === String(userId)
  );

  return reaction ? reaction.emoji : null;
}

function ReactionMenu({ msg, isPost = false, onReactLocal }) {
  const { socket } = useSocket();
  const { user, accessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [myReaction, setMyReaction] = useState(getMyReaction(msg, user.id));
  const navigate = useNavigate();

  // Floating UI for main reactions menu
  const { refs: menuRefs, floatingStyles: menuStyles } = useFloating({
    placement: "bottom-start",
    middleware: [offset(-30), flip()],
    whileElementsMounted: autoUpdate,
  });

  // Floating UI for emoji picker (separate instance)
  const { refs: emojiRefs, floatingStyles: emojiStyles } = useFloating({
    placement: "bottom-start",
    middleware: [offset(isPost ? 4 : 0 ), flip()],
    whileElementsMounted: autoUpdate,
  });

  const menuBtnRef = menuRefs.setReference;
  const emojiBtnRef = emojiRefs.setReference;

  useEffect(() => {
    setMyReaction(getMyReaction(msg, user.id))
  }, [msg, user.id])

  // Click outside handling
  useEffect(() => {
    function handleClickOutside(e) {
      const menuEl = menuRefs.floating.current;
      const menuBtnEl = menuRefs.reference.current;
      const emojiEl = emojiRefs.floating.current;
      const emojiBtnEl = emojiRefs.reference.current;

      if (
        open &&
        menuEl &&
        menuBtnEl &&
        !menuEl.contains(e.target) &&
        !menuBtnEl.contains(e.target) &&
        (!emojiEl || !emojiEl.contains(e.target)) &&
        (!emojiBtnEl || !emojiBtnEl.contains(e.target))
      ) {
        setOpen(false);
        setShowEmoji(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, menuRefs, emojiRefs]);

  const reactions = [
    { emoji: "😭", label: "crying" },
    { emoji: "💀", label: "dead" },
    { emoji: "✨", label: "rose" },
    { emoji: "🔥", label: "fire" },
    { emoji: "❤️", label: "love" },
  ];

  // Handle reaction click
  const handleReact = async (emoji) => {
    if (!emoji) return;

    const isRemoving = myReaction === emoji;

    // Optimistic UI update for posts
    if (isPost && typeof onReactLocal === "function") {
      onReactLocal(emoji, user.id);
    }

    const payload =  {
      emoji,
      msgId: msg._id,
      userId: user.id,
      chatId: msg.chatId,
      removing: isRemoving,
    }

    try{
      const res = await fetch('/api/reaction', {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if(!res.ok) {
        throw new Error();
      }

      const data = await res.json();

      socket.emit("reaction", data.reaction)
    } catch (err) {
      console.error(err);
      navigate('/crash')
    }

    setOpen(false);
    setShowEmoji(false);
  };

  // EmojiPicker callback
  const handleEmojiClick = (emojiData) => {
    handleReact(emojiData.emoji);
  };

  return (
    <div className={isPost ? "rm-container width-on-post" : "rm-container"}>
      {/* Reactions button */}
      <button
        ref={menuBtnRef}
        className={isPost ? "rm-btn-post" : "rm-btn"}
        onClick={(e) => {
          e.preventDefault();
          setOpen((prev) => !prev);
        }}
        type="button"
      >
        { !myReaction ? (
            <img className="rm-btn-img" src={reactImg} alt="menu" />
          ) : (
            <p className="my-reaction">{myReaction}</p>
          )
        }
        {isPost && !myReaction && "React"}
        {isPost && myReaction && "Reacted"}
      </button>

      {/* Main reactions menu */}
      {open && (
        <div ref={menuRefs.setFloating} style={menuStyles} className="rm-menu-container">
          {reactions.map((r) => (
            <button
              key={r.label}
              className="rm-inner-btn"
              onClick={() => handleReact(r.emoji)}
              type="button"
            >
              {r.emoji}
            </button>
          ))}

          {/* Emoji picker toggle */}
          <button
            type="button"
            className="emoji-btn"
            ref={emojiBtnRef}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowEmoji((v) => !v)}
          >
            <MyPlusIcon style={{height: '35px', width: '35px', color: '#c5cad3'}} />
          </button>
        </div>
      )}

      {/* Emoji picker */}
      {showEmoji && (
        <div ref={emojiRefs.setFloating} style={{ ...emojiStyles, zIndex: 99999 }}>
          <EmojiPicker onEmojiClick={handleEmojiClick} emojiStyle={EmojiStyle.TWITTER} theme="dark" defaultSkinTone="white" />
        </div>
      )}
    </div>
  );
}

export default ReactionMenu;
