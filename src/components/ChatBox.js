import './ChatBox.css';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import EmojiPicker, { EmojiStyle } from 'emoji-picker-react';
import { useFloating, offset, autoUpdate, flip } from '@floating-ui/react';
import { useAuth } from '../context/AuthContext';
import ChatInfo from './ChatInfo';
import AttachmentMenu from './AttachmentMenu';
import eyeIcon from '../images/viewer-icon.png';
import reactImg from "../images/reaction-fontcolor.png";
import closeImg from '../images/close-gray.png';
import sendImg from '../images/send.png';
import micImg from '../images/microphone.png';
import downImg from '../images/down-arrow.png';
import recordingIcon from '../images/voice.png';
import { useNavigate } from 'react-router-dom';
import MediaView from './MediaView.js';
import MediaMessagePreview from './MediaMessagePreview.js';
import { useSocket, useSocketEvent } from '../context/SocketContext.js';
import TextMessage from './TextMessage.js';
import MediaMessage from './MediaMessage.js';
import AudioMessage from './AudioMessage.js';
import ChatInfoMessage from './ChatInfoMessage.js';
import LoadingMessages from './LoadingMessages.js';
import { ReactComponent as MyIcon } from '../images/comment.svg';


function ChatBox({ setChats, paramChatId, selectedChat, setSelectedChat, messages, setMessages, typingUsers, setShowLiveChat, showLiveChat, focusMessageId, clearFocus }) {

  const senderColors = ['#c76060', '#c79569', '#c7c569', '#6ec769', '#69c2c7', '#6974c7', '#9769c7', '#c769bf']

  const { socket } = useSocket();
  const [files, setFiles] = useState([]);
  const [chatInfoClass, setChatInfoClass] = useState(' hidden');
  const [showEmoji, setShowEmoji] = useState(false);
  const [message, setMessage] = useState('');
  const [chatLiveCount, setChatLiveCount] = useState(0);
  const { user, accessToken } = useAuth();
  const [clickedMedia, setClickedMedia] = useState(null);
  const [recording, setRecording] = useState(false);
  const [clickedMsg, setClickedMsg] = useState(null);
  const [hasMoreMsgs, setHasMoreMsgs] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isReply, setIsReply] = useState(false);
  const [repliedTo, setRepliedTo] = useState(null);
  const [showNewMsgPill, setShowNewMsgPill] = useState(false);
  const [newLiveChatMsg, setNewLiveChatMsg] = useState(false);

  const MAX_AUDIO_MS = 10 * 60 * 1000; // 10 minutes
  const stopTimeoutRef = useRef(null);
  const messagesBoxRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const emojiPickerRef = useRef(null);
  const msgRef = useRef(null);
  const msgRefs = useRef({});
  const caretPosRef = useRef(0);
  const restoreRef = useRef(null); 
  const PAGE_SIZE = 20;

  const { refs, floatingStyles } = useFloating({
    placement: "top-start",
    middleware: [offset(4), flip()],
    whileElementsMounted: autoUpdate
  });

  const navigate = useNavigate();

  const isFocusingRef = useRef(false);

  const messagesRef = useRef([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!focusMessageId) return;

    const container = messagesBoxRef.current;
    const node = msgRefs.current[String(focusMessageId)];

    if (!container || !node) return;

    // Scroll directly to the element
    node.scrollIntoView({
      behavior: "smooth",
      block: "center",   // center it in the container
    });

    clearFocus?.();

  }, [focusMessageId, messages.length]);

  function scrollToBottom(smooth = true) {
    const el = messagesBoxRef.current;
    if (!el) return;

    el.scrollTo({
      top: 0,
      behavior: smooth ? "smooth" : "auto",
    });

    setShowNewMsgPill(false);
  }

  function isNearBottom(threshold = 80) {
    const el = messagesBoxRef.current;
    if (!el) return true;

    return el.scrollTop < threshold;
  }

  useEffect(() => {
    setShowNewMsgPill(false);
  }, [selectedChat?._id]);

  useEffect(() => {
    return () => {
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    };
  }, []);

  useEffect(() => {
    if (!focusMessageId) return;
    if (!hasMoreMsgs) return;

    const node = msgRefs.current[String(focusMessageId)];
    if (node) return; // already in DOM

    // not loaded yet → load older once
    loadOlderMessages();
  }, [focusMessageId, messages.length, hasMoreMsgs]);
  
  useEffect(() => {
    if (!focusMessageId) return;
    console.log(
      "focus exists in state?",
      messages.some(m => String(m._id) === String(focusMessageId))
    );
  }, [focusMessageId, messages]);

  useSocketEvent('liveViewerCount', ({ chatId, count }) => {
    if (chatId === selectedChat._id) {
      console.log('hi from liveViewerCount');
      setChatLiveCount(count);
    }
  });

  useSocketEvent('liveComment', ({ chatId, comment }) => {
    console.log('A live comment came')
    if (String(chatId) === String(selectedChat._id) && !showLiveChat) {
      setNewLiveChatMsg(true);
    }
  })

  useSocketEvent("message", (payload) => {
    const msg = payload;
    if (!msg || !selectedChat?._id) return;
    if (isFocusingRef.current) return;

    if (String(msg.chatId) !== String(selectedChat._id)) return;

    const senderId = String(msg.from?._id);

    if (senderId === String(user.id)) {
      return;
    }

    if (isNearBottom()) {
      // user is already near bottom → scroll
      setTimeout(() => scrollToBottom(true), 0);
    } else {
      // user scrolled up → show pill
      setShowNewMsgPill(true);
    }
  }, [selectedChat?._id, user?.id]);

  useSocketEvent("messagesBatch", (payload) => {
    if (isFocusingRef.current) return;
    console.log('Helloofrom chatBox')
    if (String(payload.chatId) !== String(selectedChat._id)) return;

    if (isNearBottom()) {
      // user is already near bottom → scroll
      setTimeout(() => scrollToBottom(true), 0);
    } else {
      // user scrolled up → show pill
      setShowNewMsgPill(true);
    }
  }, [selectedChat?._id]);

  useEffect(() => {
    const parent = messagesBoxRef.current;
    if (!parent) return;

    const onScroll = () => {
      if (isNearBottom()) {
        setShowNewMsgPill(false);
      }
    };

    parent.addEventListener('scroll', onScroll);

    return () => {
      parent.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {

    function handleClickOutside(e) {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target)
      ) {
        setShowEmoji(false)
      }
    }

    if (showEmoji) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showEmoji]);

  async function loadOlderMessages() {
    if (!selectedChat || !hasMoreMsgs || loadingMoreRef.current) return;

    const el = messagesBoxRef.current;
    if (!el) return;

    const chatId = selectedChat._id;

    const prevScrollHeight = el.scrollHeight;
    const prevScrollTop = el.scrollTop;

    restoreRef.current = {
      prevScrollTop: el.scrollTop,
    };

    console.log(restoreRef.current);

    try {
      setLoadingMore(true);
      loadingMoreRef.current = true;

      const currentMsgs = messagesRef.current;
      const oldest = currentMsgs[currentMsgs.length - 1];
      if (!oldest?._id) return;

      const res = await fetch(
        `/api/messages/${encodeURIComponent(chatId)}?limit=${PAGE_SIZE}&before=${oldest._id}`,
        { method: "GET", headers: { authorization: `Bearer ${accessToken}` } }
      );

      if (!res.ok) throw new Error("Load older failed");
      const data = await res.json();
      const olderBatch = data.msgs || [];

      if (olderBatch.length === 0) {
        setHasMoreMsgs(false);
        return;
      }

      // if user switched chats while fetching, don't apply
      if (chatId !== selectedChat._id) return;

      setMessages(prev => [...prev, ...olderBatch]); // or prepend depending on your ordering
      setHasMoreMsgs(Boolean(data.hasMore));

    } catch (e) {
      console.error(e);
      navigate("/crash");
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }

  useLayoutEffect(() => {
    console.log(restoreRef.current)
    const el = messagesBoxRef.current;
    const snap = restoreRef.current;
    if (!el || !snap) return;

    // ✅ for column-reverse with negative scrollTop: preserve raw scrollTop
    el.scrollTop = snap.prevScrollTop;

    restoreRef.current = null;
  }, [messages.length]);

  useEffect(() => {
    if (!selectedChat) return;

    let cancelled = false; // prevents state updates after unmount/switch

    async function loadInitialAndJoin() {
      try {
        // ---------- 1) LAZY LOAD INITIAL MESSAGES ----------
        setLoadingMore(true);
        loadingMoreRef.current = true;

        const res = await fetch(
          `/api/messages/${encodeURIComponent(selectedChat._id)}?limit=${PAGE_SIZE}`,
          {
            method: "GET",
            headers: { authorization: `Bearer ${accessToken}` },
          }
        );

        if (!res.ok) throw new Error("Request failed");
        const data = await res.json();

        if (cancelled) return;

        // API returns newest->oldest (desc), reverse for render order oldest->newest
        const initialMsgs = [...(data.msgs || [])];
        setMessages(initialMsgs);
        setHasMoreMsgs(Boolean(data.hasMore));

        // scroll to bottom after first load
        setTimeout(() => {
          if (cancelled) return;
          if (focusMessageId) return; 
        }, 0);

        // ---------- 2) JOIN/OPEN CHAT LOGIC ----------
        const chatId = selectedChat._id;

        const isParticipant = Array.isArray(selectedChat.participants)
          ? selectedChat.participants.some((p) => p?._id === user.id)
          : false;

        // Everyone joins room (so they receive updates like reactions/live counts)
        socket.emit("joinChat", { chatId, role: isParticipant ? 'member' : 'viewer' });

        // Only participants trigger "opened by participant" + subscriber notifications
        if (isParticipant) {
          socket.emit("chatOpenedByParticipant", { chatId, userId: user.id });

          // Notify subscribers (your existing behavior)
          const subs = Array.isArray(selectedChat.subscribers) ? selectedChat.subscribers : [];

          // IMPORTANT: your earlier code used .map without await; this keeps your behavior
          subs.forEach((sub) => {
            // If subs are objects sometimes, normalize to id
            const subId = typeof sub === "object" ? sub?._id : sub;

            const body = {
              user: subId,
              sender: user.id,
              type: "chat_participant_joined",
              chat: chatId,
              message: null,
              text: "",
            };

            fetch(`/api/notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                authorization: `Bearer ${accessToken}`,
              },
              credentials: "include",
              body: JSON.stringify(body),
            })
              .then((r) => {
                if (!r.ok) throw new Error("Notification request failed");
                return r.json();
              })
              .then((d) => {
                if (cancelled) return;
                if (d?.notification) socket.emit("notification", d.notification);
              })
              .catch((err) => {
                console.error(err);
                navigate('/crash')
              });
          });
        }
      } catch (err) {
        console.error(err);
        navigate('/crash')
      } finally {
        if (!cancelled) {
          setLoadingMore(false);
          loadingMoreRef.current = false;
        }
      }
    }

    loadInitialAndJoin();

    // ---------- CLEANUP: leave chat on switch/unmount ----------
    return () => {
      cancelled = true;

      if (socket && selectedChat?._id) {
        socket.emit("leaveChat", selectedChat._id);
        console.log("left chat:", selectedChat._id);
      }

      // also stop typing if user leaves while typing (optional but recommended)
      if (socket && isTypingRef.current && selectedChat?._id) {
        socket.emit("typing", { chatId: selectedChat._id, userId: user.id, typing: false });
        isTypingRef.current = false;
      }

      // clear the typing timeout (optional)
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [selectedChat, accessToken, socket, user.id, focusMessageId]);

  useEffect(() => {
    const el = messagesBoxRef.current;
    if (!el) return;

    function onScroll() {
      const maxScrollTop = el.scrollHeight - el.clientHeight;
  
      if (Math.abs(maxScrollTop + el.scrollTop) <= 40) {
        if (loadingMoreRef.current || !hasMoreMsgs) return;
        console.log('hello from the otherside')
        loadOlderMessages();
      }
    }

    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [selectedChat?._id]);

  useEffect(() => {
    if (!selectedChat) return;
    if (focusMessageId) return;
    scrollToBottom(false);
  }, [selectedChat._id]);

  useEffect(() => {
    if (!selectedChat) {
      setMessages([]);
      return;
    }

    setMessages([]);
    setHasMoreMsgs(true);
  }, [selectedChat?._id]);

  function handleSubscribe(e) {
    e.preventDefault();
    fetch('/api/chat/subscribe', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ chatId: selectedChat._id })
    }).then(res => {
      if (!res.ok) {
        throw new Error();
      }
      return res.json();
    }).then(data => {
      setSelectedChat(prev => ({
        ...prev,
        subscribers: data.subscribers
      }))
    }).catch(err => {
      console.error(err);
      navigate('/crash')
    })
  }

  function handleUnsubscribe(e) {
    e.preventDefault();
    fetch('/api/chat/unsubscribe', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ chatId: selectedChat._id })
    }).then(res => {
      if (!res.ok) {
        throw new Error();
      }
      return res.json();
    }).then(data => {
      setSelectedChat(prev => ({
        ...prev,
        subscribers: data.subscribers
      }))
    }).catch(err => {
      console.error(err);
      navigate('/crash')
    })
  }

  function handleCloseChat(e) {
    e.preventDefault();
    setSelectedChat(null);
    setMessages([]);
    setMessage('');
    setChatLiveCount(0);
    if (paramChatId) {
      navigate('/')
    }
  }

  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);

  function handleInputChange(e) {
    const text = e.target.value;
    setMessage(text);

    if (socket && selectedChat) {
      if (!isTypingRef.current) {
        // only emit once when typing starts
        socket.emit("typing", { chatId: selectedChat._id, userId: user.id, typing: true });
        isTypingRef.current = true;
      }

      // clear the old timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // set a new timeout (2s) to mark typing as stopped
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("typing", { chatId: selectedChat._id, userId: user.id, typing: false });
        isTypingRef.current = false;
      }, 2000);
    }
  }

  function sendMessage(e) {
    e.preventDefault();
    if (!message.trim()) return;
    if (socket && selectedChat) {
      if (files.length === 0) {

        const optimisticId = Date.now();

        const newMessageBody = {
          optimisticId,
          from: user.id,
          chatId: selectedChat._id,
          type: "text",
          isReply: isReply ? true : false,
          repliedTo: isReply ? repliedTo._id : null,
          reactions: [],
          media: [],
          message: message.trim(),
        }

        setMessages(prev => [
          {
            from: {
              _id: user.id,
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
            },
            chatId: selectedChat._id,
            type: 'text',
            isReply: isReply ? true : false,
            repliedTo: (isReply && repliedTo) ? repliedTo : null,
            reactions: [],
            media: [],
            message: message.trim(),
            _id: optimisticId,
            pending: true,
            timestamp: Date.now(),
          },
          ...prev
        ]);

        setTimeout(() => scrollToBottom(false), 0);

        fetch('/api/message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify(newMessageBody),
        }).then(res => {
          if (!res.ok) {
            throw new Error();
          }
          return res.json();
        }).then(data => {
          if (data.message) {
            console.log(data.message)
            setMessages(prev =>
              prev.map(m =>
                String(m._id) === String(data.optimisticId)
                  ? { ...data.message }
                  : m
              )
            );

            socket.emit("message", { message: data.message });
          }
        }).catch(err => {
          console.error(err);
          navigate('/crash')
        });
        setIsReply(false);
        setRepliedTo(null);
        setMessage("");
      }
    }
  }

  async function handleAudioMessage(e) {
    e.preventDefault();

    if (!recording) {
      // start recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        // clear the auto-stop timer
        if (stopTimeoutRef.current) {
          clearTimeout(stopTimeoutRef.current);
          stopTimeoutRef.current = null;
        }

        recorder.stream.getTracks().forEach(track => track.stop());

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size > 30 * 1024 * 1024) return;

        // ✅ optimistic render
        const optimisticId = Date.now();
        const localUrl = URL.createObjectURL(blob);

        setMessages(prev => [
          {
            from: {
              _id: user.id,
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
            },
            chatId: selectedChat._id,
            type: "audio",
            isReply: false,
            repliedTo: null,
            reactions: [],
            message: " ",
            media: [{ url: localUrl, type: "audio" }], // matches schema
            _id: optimisticId,
            pending: true,
            timestamp: Date.now(),
          },
          ...prev
        ]);

        const formData = new FormData();
        formData.append("audio", blob, "audio.webm");

        try {
          const upRes = await fetch(`/api/upload-audio`, {
            method: "POST",
            headers: { authorization: `Bearer ${accessToken}` },
            body: formData,
          });

          if (!upRes.ok) throw new Error("Upload failed");
          const data = await upRes.json();

          const media = data.media; // should be [{ url, type: 'audio' }] (or compatible)

          const newMessageBody = {
            optimisticId,
            from: user.id,
            chatId: selectedChat._id,
            type: "audio",
            message: " ",
            media,
          };

          const msgRes = await fetch("/api/message", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(newMessageBody),
          });

          if (!msgRes.ok) throw new Error("Message send failed");
          const msgData = await msgRes.json();

          if (msgData.message) {
            // replace optimistic with real
            setMessages(prev =>
              prev.map(m =>
                String(m._id) === String(msgData.message.optimisticId)
                  ? { ...msgData.message, _id: msgData.message._id }
                  : m
              )
            );

            // cleanup local blob URL (avoid memory leak)
            URL.revokeObjectURL(localUrl);

            socket.emit("message", { message: msgData.message });
          }

          socket.emit("typing", {
            chatId: selectedChat._id,
            userId: user.id,
            typing: false
          });

          setFiles([]);
          setMessage("");
        } catch (err) {
          console.error(err);

          // optional: mark optimistic as failed instead of crashing
          // setMessages(prev =>
          //   prev.map(m => String(m._id) === String(optimisticId) ? { ...m, pending: false, failed: true } : m)
          // );

          navigate("/crash");
        }
      };

      recorder.start();
      setRecording(true);

      // ✅ auto-stop at 10 minutes
      stopTimeoutRef.current = setTimeout(() => {
        if (recorderRef.current && recorderRef.current.state === "recording") {
          recorderRef.current.stop();
          setRecording(false);
        }
      }, MAX_AUDIO_MS);

    } else {
      // stop recording manually
      if (stopTimeoutRef.current) {
        clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = null;
      }
      recorderRef.current.stop();
      setRecording(false);
    }
  }

  function onEmojiClick(emojiData) {
    const emoji = emojiData.emoji;
    const pos = caretPosRef.current;

    const newText =
      message.slice(0, pos) + emoji + message.slice(pos);

    const newCaretPos = pos + emoji.length;
    caretPosRef.current = newCaretPos

    setTimeout(() => {
      if (msgRef.current) {
        msgRef.current.selectionStart = newCaretPos;
        msgRef.current.selectionEnd = newCaretPos;
        msgRef.current.focus();
      }
    }, 0)

    setMessage(newText);
  }

  function saveCaret(e) {
    caretPosRef.current = e.target.selectionStart;
  }

  let newSender = false;

  return (
    <div className="chat-box">
      {files.length > 0 && <MediaMessagePreview files={files} setFiles={setFiles} selectedChat={selectedChat} setMessages={setMessages} isReply={isReply} repliedTo={repliedTo} setIsReply={setIsReply} setRepliedTo={setRepliedTo} />}
      {clickedMedia && clickedMsg && <MediaView msg={clickedMsg} media={clickedMedia} setClickedMedia={setClickedMedia} />}
      {selectedChat && <ChatInfo setChats={setChats} selectedChat={selectedChat} setSelectedChat={setSelectedChat} chatInfoClass={chatInfoClass} setChatInfoClass={setChatInfoClass} setMessages={setMessages} />}
      {showNewMsgPill && (
        <button
          type="button"
          className="new-msg-pill"
          onClick={() => scrollToBottom(true)}
        >
          <img src={downImg} />
          <p>New Message</p>
        </button>
      )}
      {selectedChat &&
        (<div className='chat-heading-and-btns-container'>
          <div className='chatName-chatDp-container'>
            <div className='chatDp-container'>
              <img onClick={() => setChatInfoClass('')} className='chatDp' src={selectedChat.chatDp} />
            </div>
            <h3 onClick={() => setChatInfoClass('')} className='chat-box-heading'>{selectedChat.chatName}</h3>
            {!selectedChat.participants.some(p => p._id === user.id) && (
              selectedChat?.subscribers.includes(user.id) ?
                (<button className='unsubscribe-btn' onClick={handleUnsubscribe}>Unsubscribe</button>) :
                (<button className='subscribe-btn' onClick={handleSubscribe}>Subscribe</button>)
            )}
          </div>
          <p className='chat-live-count'><img className='chat-live-count-img' src={eyeIcon} /> {chatLiveCount}</p>
          <div className='chat-btns-container'>
            <button className='show-live-chat-btn' onClick={() => { setShowLiveChat(prev => !prev); setNewLiveChatMsg(false) }}>
              <MyIcon fill='#c5cad3' style={{ height: '18px', width: '18px', color: '#c5cad3' }} />
              {newLiveChatMsg && <div className='new-indicator'></div>}
            </button>
            <button className='chat-close-btn' onClick={handleCloseChat}><img className='chat-close-img' src={closeImg} /></button>
          </div>
        </div>)
      }
      <div className='messages-box' ref={messagesBoxRef}>

        {loadingMore && messages.length === 0 && <LoadingMessages />}

        {/* ✅ Typing indicator */}
        {typingUsers.length > 0 && (
          <div className="typing-indicator">
            <div className="dot"></div>
            <div className="dot"></div>
            <div className="dot"></div>
          </div>
        )}

        {[...messages].map((msg, index) => {
          const id = String(msg._id);

          // ---- your existing newSender logic ----
          if (index === messages.length - 1) {
            newSender = true;
          } else {
            if (String(msg.from._id) !== String(messages[index + 1].from._id)) {
              newSender = true;
            } else {
              newSender = false;
            }
            if (messages[index + 1].type === 'chatInfo') {
              newSender = true;
            }
            if (msg.type === 'media' || msg.type === 'audio') {
              newSender = true;
            }
          }

          // ---- your existing component selection ----
          const content =
            msg.type === 'text' ? (
              <TextMessage
                newSender={newSender}
                setIsReply={setIsReply}
                setRepliedTo={setRepliedTo}
                msg={msg}
                sender={msg.from}
                setMessages={setMessages}
                selectedChat={selectedChat}
                setClickedMsg={setClickedMsg}
              />
            ) : msg.type === 'media' && msg.media.length > 0 ? (
              <MediaMessage
                newSender={newSender}
                setIsReply={setIsReply}
                setRepliedTo={setRepliedTo}
                msg={msg}
                sender={msg.from}
                setMessages={setMessages}
                setClickedMedia={setClickedMedia}
                selectedChat={selectedChat}
                setClickedMsg={setClickedMsg}
              />
            ) : msg.type === 'audio' ? (
              <AudioMessage
                newSender={newSender}
                setIsReply={setIsReply}
                setRepliedTo={setRepliedTo}
                msg={msg}
                setMessages={setMessages}
                sender={msg.from}
                selectedChat={selectedChat}
                setClickedMsg={setClickedMsg}
              />
            ) : msg.type === 'chatInfo' ? (
              <ChatInfoMessage msg={msg} />
            ) : null;

          // ---- wrapper that stores refs + highlight class ----
          return (
            <div
              key={id}
              ref={(el) => {
                if (el) msgRefs.current[id] = el;
              }}
              className={focusMessageId && String(focusMessageId) === id ? "focus-msg" : ""}
            >
              {content}
            </div>
          );
        })}
      </div>
      {selectedChat && selectedChat.participants.some(p => p._id === user.id) && (
        <form className='msg-input-form' onSubmit={sendMessage}>
          {
            isReply && repliedTo &&
            (
              <div className='replyee-msg-container'>
                <div className='close-reply-container'>
                  <button type='button' onClick={() => { setIsReply(false); setRepliedTo(null) }}>
                    <img src={closeImg} />
                  </button>
                </div>
                <h1 style={{ color: `${senderColors[selectedChat.participants.findIndex(p => p._id === repliedTo.from._id)]}` }}>{repliedTo.from.firstName + ' ' + repliedTo.from.lastName}</h1>
                <p>
                  {repliedTo.type === 'text' && repliedTo.message}

                  {repliedTo.type === 'media' &&
                    `${repliedTo.media?.length || 0} media`}

                  {repliedTo.type === 'audio' && 'Audio Message'}
                </p>
              </div>
            )
          }
          <AttachmentMenu setFiles={setFiles} />
          <button type='button' className='emoji-btn' ref={refs.setReference} onMouseDown={(e) => e.preventDefault()} onClick={() => setShowEmoji(v => !v)}><img src={reactImg} /></button>

          {showEmoji && (
            <div ref={(el) => {
              refs.setFloating(el);
              emojiPickerRef.current = el;
            }} style={floatingStyles}>
              <EmojiPicker onEmojiClick={onEmojiClick} emojiStyle={EmojiStyle.TWITTER} theme='dark' defaultSkinTone='white' />
            </div>
          )}

          {recording ? (
            <div className='recording-indicator'>
              <img src={recordingIcon} className='recording-img' />
              <p>Recording......</p>
            </div>
          ) : (
            <input
              ref={msgRef}
              className="msg-input"
              value={message}
              onChange={handleInputChange}
              onClick={saveCaret}
              onKeyUp={saveCaret}
              spellCheck='false'
              placeholder='Enter Message'
            />
          )
          }
          {!!message ? (
            <button className='msg-send-btn' onClick={sendMessage}><img className='msg-send-img' src={sendImg} /></button>
          ) : (
            <button className='audio-msg-btn' onClick={handleAudioMessage}><img className='audio-btn-img' src={recording ? sendImg : micImg} /></button>
          )
          }
        </form>)
      }
    </div>
  )
}


export default ChatBox;