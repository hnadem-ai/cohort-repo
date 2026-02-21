// src/Home.jsx
import './Home.css'
import { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext'
import { useSocket, useSocketEvent } from './context/SocketContext';
import NavBar from './components/NavBar';
import HomeNav from './components/HomeNav';
import ChatBox from './components/ChatBox';
import Posts from './components/Posts'
import LiveChatView from './components/LiveChatCommentsView';
import { useParams, useNavigate, useLocation } from 'react-router-dom';

function Home() {
  const paramChatId = useParams().chatId;
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [chats, setChats] = useState([]);
  const [users, setUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const { user, accessToken, loading } = useAuth();
  const [showLiveChat, setShowLiveChat] = useState(true);
  const [userChats, setUserChats] = useState([]);
  const [isNewMessage, setIsNewMessage] = useState(false);
  const [newMessageChatIds, setNewMessageChatIds] = useState([]);
  const location = useLocation();
  const focusMessageId = location.state?.focusMessageId ?? null;

  const { markMessagesRead, chatOpened } = useSocket();

  const clearFocus = () => {
    navigate(location.pathname, { replace: true, state: {} });
  };

  useEffect(() => {
    if(!accessToken && !loading){
      navigate('/login');
    }
  },[accessToken]);

  useEffect(() => {
    if (!accessToken || !paramChatId || loading) return;

    fetch(`/api/chats/${paramChatId}`, {
      method: 'GET',
      headers: { 'authorization': `Bearer ${accessToken}` }
    })
      .then(response => {
        if (!response.ok) {
          console.log(response);
          throw new Error('Request Failes!');
        }
        return response.json();
      })
      .then(data => setSelectedChat(data.chat))
      .catch(err => {
        console.error(err);
        navigate('/crash')
      });
  }, [paramChatId, accessToken, loading]);

  useEffect(() => {
    if (!accessToken || loading) return;

    fetch(`/api/chats`, {
      method: 'GET',
      headers: { 'authorization': `Bearer ${accessToken}` },
      credentials: 'include'
    })
      .then(response => {
        if (!response.ok) throw new Error('Request Failed with Status: ' + response.status);
        return response.json();
      })
      .then(data => setChats(data.chats))
      .catch(err => {
        console.error(err);
        navigate('/crash');
      });
  }, [accessToken, loading]);

  useEffect(() => {
    if (!accessToken || loading) return;
    
    fetch('/api/users', {
      method: 'GET',
      headers: { 'authorization': `Bearer ${accessToken}` }
    })
      .then(r => { if (!r.ok) throw new Error('Request failed: ' + r.status); return r.json(); })
      .then(data => {
        setUsers(data.users || []);
      })
      .catch(err => {
        console.error(err);
        navigate('/crash');
      });
  }, [accessToken, loading]);

   useEffect(() => {
    if (!accessToken || loading) return;
    
    fetch(`/api/user-chats/${encodeURIComponent(user.id)}`, {
      method: 'GET',
      headers: { 'authorization': `Bearer ${accessToken}` }
    })
      .then(r => { if (!r.ok) throw new Error('Request failed: ' + r.status); return r.json(); })
      .then(data => {
        setUserChats(data.chats || []);
      })
      .catch(err => {
        console.error(err);
        navigate('/crash');
      });
  }, [accessToken, loading]);

  const updateReactions = (existing = [], data) => {
    const filtered = existing.filter(r => String(r.userId) !== String(data.userId));
    return [...filtered, { userId: data.userId, emoji: data.emoji }];
  };

  useSocketEvent('participantRemoved', ({userId, chatId, msg}) => {
    setChats(prev => prev.map(chat => {
      if (chat._id === chatId) {
        const updatedChat = {
          ...chat,
          participants: chat.participants.filter(p => p._id !== userId),
        };
        return updatedChat;
      }
      return chat;
    }));
    if(selectedChat._id === chatId){
      setMessages(prev => [msg, ...prev]);
    }
  })

  useSocketEvent('participantAccepted', ({ chatId, user }) => {
    setChats(prev => prev.map(chat => {
      if (chat._id === chatId) {
        const updatedChat = {
          ...chat,
          participants: [ ...chat.participants, user ],
        };
        return updatedChat;
      }
      return chat;
    }));
  })

  useSocketEvent('participantRequested', ({ chatId, msg }) => {
    if(selectedChat._id === chatId){
      setMessages(prev => [msg, ...prev]);
    }
  })

  useSocketEvent("message", (msg) => {
    console.log('hello from messages')
    if(msg.from._id === user.id) return;
    if(userChats.some(uChat => String(msg.chatId) === String(uChat._id))){
      console.log('true hogyay bhabhasbasdasdfasdfasdfasdfasdfasdfasdfasdfdhabsd');
      if(String(msg.chatId) !== String(selectedChat._id) ) {
        setNewMessageChatIds(prev => [...prev, msg.chatId]);
        setIsNewMessage(true);
      }
    }
    const isForSelected = selectedChat && String(msg.chatId) === String(selectedChat._id);

    if (isForSelected) {
      if (user?.id && String(msg.from) !== String(user.id)) {
        markMessagesRead({ chatId: selectedChat._id, msgId: msg._id, to: msg.from });
      }
      setMessages(prev => [msg, ...prev]);
    } else {
      setChats(prev =>
        prev.map(chat =>
          String(chat._id) === String(msg.chatId)
            ? { ...chat, noOfUnreadMessages: (chat.noOfUnreadMessages || 0) + 1 }
            : chat
        )
      );
    }
  }, [selectedChat?._id, user?.id]);

  useSocketEvent(
    "messagesBatch",
    ({ chatId, messages }) => {
      if (!Array.isArray(messages) || messages.length === 0) return;

      const isForSelected =
        selectedChat && String(chatId) === String(selectedChat._id);

      if (isForSelected) {
        const stampedMessages = messages.map(msg => ({
          ...msg,
          timestamp: Date.now()
        }));
        // prepend messages to current chat
        // reverse only if backend sends oldest → newest
        setMessages(prev => [...[...stampedMessages].reverse(), ...prev]);
      } else {
        // increment unread count by batch size
        setChats(prev =>
          prev.map(chat =>
            String(chat._id) === String(chatId)
              ? {
                ...chat,
                noOfUnreadMessages:
                  (chat.noOfUnreadMessages || 0) + messages.length
              }
              : chat
          )
        );
      }
    },
    [selectedChat?._id]
  );

  useSocketEvent("messageSent", ({newMessage}) => {
    console.log('Message sent Successfully!', newMessage)
  }, []);

  useSocketEvent("messagesRead", ({ chatId, reader }) => {
    if (!selectedChat || String(selectedChat._id) !== String(chatId)) return;
    setMessages(prev =>
      prev.map(m => (String(m.from) !== String(reader) ? { ...m, read: true } : m))
    );
  }, [selectedChat?._id]);

  useSocketEvent("reaction", ({ emoji, msgId, userId, username }) => {
    console.log('reaction')
    setMessages(prev =>
      prev.map(msg =>
        String(msg._id) === String(msgId)
          ? { ...msg, reactions: updateReactions(msg.reactions, { emoji, msgId, userId }) }
          : msg
      )
    );
  }, []);

  useSocketEvent("deleteMessage", (serverMsg) => {
    if (!selectedChat || String(serverMsg.chatId) !== String(selectedChat._id)) return;
    setMessages(prev => prev.filter(msg => String(msg._id) !== String(serverMsg._id)));
  }, [selectedChat?._id]);

  useSocketEvent("typing", (data) => {
    if (!selectedChat || String(data.chatId) !== String(selectedChat._id) || String(data.userId) === String(user.id)) return;

    if (data.typing) {
      setTypingUsers(prev => {
        if (prev.find(u => String(u.userId) === String(data.userId))) return prev;
        return [...prev, { userId: data.userId, username: data.username }];
      });
    } else {
      setTypingUsers(prev => prev.filter(u => String(u.userId) !== String(data.userId)));
    }
  }, [selectedChat?._id]);

  useEffect(() => {
    if (!selectedChat) return;
    

    setChats(prev =>
      prev.map(chat =>
        String(chat._id) === String(selectedChat._id)
          ? { ...chat, noOfUnreadMessages: 0 }
          : chat
      )
    );

    setNewMessageChatIds(prev => {
      const next = prev.filter(c => String(c) !== String(selectedChat._id));
      setIsNewMessage(next.length > 0);
      return next;
    });

    chatOpened(selectedChat._id);
  }, [selectedChat, chatOpened]);

  if (loading) return null;

  if (!accessToken) return null;

  return (
    <div className="home">
      <title>Home | CohortBox</title>
      <NavBar selectedChat={selectedChat}/>
      <HomeNav newMessageChatIds={newMessageChatIds} setNewMessageChatIds={setNewMessageChatIds} isNewMessage={isNewMessage} setIsNewMessage={setIsNewMessage} users={users} setUsers={setUsers} chats={chats} setChats={setChats} selectedChat={selectedChat} setSelectedChat={setSelectedChat} userChats={userChats} setUserChats={setUserChats} />
      {selectedChat ? (
        <div className='chat-box-live-chat-container'>
          <ChatBox
            setChats={setChats}
            paramChatId={paramChatId}
            selectedChat={selectedChat}
            setSelectedChat={setSelectedChat}
            messages={messages}
            setMessages={setMessages}
            typingUsers={typingUsers}
            setShowLiveChat={setShowLiveChat}
            showLiveChat={showLiveChat}
            focusMessageId={focusMessageId}
            clearFocus={clearFocus}
          />
          { showLiveChat &&
            <LiveChatView selectedChat={selectedChat} setShowLiveChat={setShowLiveChat}/>
          }  
        </div>
      ) : (
        <Posts />
      )}
    </div>
  );
}

export default Home;
