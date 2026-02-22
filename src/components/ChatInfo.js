import './ChatInfo.css';
import addUserIcon from '../images/add-user.png';
import leaveIcon from '../images/logout.png';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ChatInfoMediaView from './ChatInfoMediaView';
import SearchBar from './SearchBar';
import addPhoto from '../images/add-photo.png';

function ChatInfo({
  setChats,
  selectedChat,
  setSelectedChat,
  chatInfoClass,
  setChatInfoClass,
  setMessages
}) {
  const navigate = useNavigate();

  const PREVIEW_COUNT = 6;

  const openMediaViewer = (index = 0) => {
    setShowMediaView(true);
    setActiveMediaIndex(index);
  };

  const { user, accessToken } = useAuth();
  const { socket } = useSocket();

  const [searchBarClass, setSearchBarClass] = useState(' hidden');
  const [members, setMembers] = useState([]);
  const [totalMedia, setTotalMedia] = useState(null);

  // Raw messages returned by /api/media/:chatId
  const [mediaMsgs, setMediaMsgs] = useState([]);

  // Viewer modal
  const [showMediaView, setShowMediaView] = useState(false);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);

  // Pagination state
  const [hasMoreMedia, setHasMoreMedia] = useState(true);
  const [mediaLoading, setMediaLoading] = useState(false);

  // DOM refs
  const loadMoreMediaRef = useRef(null);
  const mediaContainerRef = useRef(null);

  // Guard refs (avoid loops)
  const didFirstLoadRef = useRef(false);
  const mediaLoadingRef = useRef(false);
  const hasMoreMediaRef = useRef(true);


  const mediaItems = useMemo(() => {
    return (mediaMsgs || []).flatMap((msg) =>
      (msg.media || []).map((m, idx) => ({
        key: `${msg._id}-${idx}`,
        url: m.url,
        type: m.type,
        messageId: msg._id,
        from: msg.from,
        timestamp: msg.timestamp,
        reactions: msg.reactions ? msg.reactions : []
      }))
    );
  }, [mediaMsgs]);

  const previewItems = useMemo(() => {
    return mediaItems.slice(0, Math.max(PREVIEW_COUNT - 1, 0));
  }, [mediaItems]);

  // Keep refs in sync with state (refs do not cause rerender)
  useEffect(() => {
    mediaLoadingRef.current = mediaLoading;
  }, [mediaLoading]);

  useEffect(() => {
    hasMoreMediaRef.current = hasMoreMedia;
  }, [hasMoreMedia]);

  // When chat changes, reset everything related to media
  useEffect(() => {
    didFirstLoadRef.current = false;
    setMediaMsgs([]);
    setHasMoreMedia(true);
    setMediaLoading(false);
    setShowMediaView(false);
    setActiveMediaIndex(0);
  }, [selectedChat?._id]);

  const fetchMoreMedia = useCallback(
    async ({ reset = false } = {}) => {
      if (!user || !accessToken || !selectedChat?._id) return;

      // Hard gates
      if (mediaLoadingRef.current) return;
      if (!hasMoreMediaRef.current && !reset) return;

      setMediaLoading(true);

      try {
        const lastId = !reset && mediaMsgs.length > 0 ? mediaMsgs[mediaMsgs.length - 1]._id : null;

        const params = new URLSearchParams();
        params.set('limit', '30');
        if (lastId) params.set('lastId', lastId);

        const res = await fetch(
          `/api/media/${encodeURIComponent(selectedChat._id)}?${params.toString()}`,
          { headers: { authorization: `Bearer ${accessToken}` } }
        );

        // Backend: 404 = nothing left (or none)
        if (res.status === 404) {
          if (reset) setMediaMsgs([]);
          setHasMoreMedia(false);
          return;
        }

        if (!res.ok) throw new Error(`Request failed: ${res.status}`);

        const data = await res.json();
        const newMsgs = data?.media || [];
        setTotalMedia(data.total);
        if (newMsgs.length === 0) {
          setHasMoreMedia(false);
          return;
        }

        setMediaMsgs((prev) => {
          const existing = new Set(prev.map((m) => String(m._id)));
          const deduped = newMsgs.filter((m) => !existing.has(String(m._id)));
          return reset ? deduped : [...prev, ...deduped];
        });

        // If fewer than limit returned, likely no more pages
        if (newMsgs.length < 30) setHasMoreMedia(false);
      } catch (err) {
        console.error(err);
      } finally {
        setMediaLoading(false);
      }
    },
    // Intentionally keep deps minimal to avoid recreating callback unnecessarily.
    // We rely on refs for loading/hasMore gates, and we only use mediaMsgs.length for lastId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, accessToken, selectedChat?._id, mediaMsgs.length]
  );

  // First load only once per "open media panel" session
  useEffect(() => {
    if (!user || !accessToken || !selectedChat?._id) return;

    if (didFirstLoadRef.current) return;
    didFirstLoadRef.current = true;

    setHasMoreMedia(true);
    hasMoreMediaRef.current = true;

    fetchMoreMedia({ reset: true });
  }, [user, accessToken, selectedChat?._id, fetchMoreMedia]);

  useEffect(() => {
    if (!mediaContainerRef.current) return;
    if (!loadMoreMediaRef.current) return;

    const rootEl = mediaContainerRef.current;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;

        if (mediaLoadingRef.current) return;
        if (!hasMoreMediaRef.current) return;

        const canScroll = rootEl.scrollHeight > rootEl.clientHeight;
        if (!canScroll) return;

        fetchMoreMedia();
      },
      {
        root: rootEl,
        rootMargin: '200px',
        threshold: 0
      }
    );

    observer.observe(loadMoreMediaRef.current);
    return () => observer.disconnect();
  }, [fetchMoreMedia]);

  // Build mediaItems from mediaMsg

  function handleRemove(e, userId, chatId) {
    e.preventDefault();
    fetch(`/api/chat/participant/${encodeURIComponent(userId)}/${encodeURIComponent(chatId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` }
    })
      .then((response) => {
        if (!response.ok) throw new Error('Request Failed!');
        setSelectedChat((prev) => ({
          ...prev,
          participants: prev.participants.filter((p) => p._id !== userId)
        }));
        socket.emit('participantRemoved', { userId, chatId });
      })
      .catch((err) => console.log(err));
  }

  function handleLeaveChat(e, userId, chatId) {
    e.preventDefault();
    fetch(`/api/chat/participant/${encodeURIComponent(userId)}/${encodeURIComponent(chatId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` }
    })
      .then((response) => {
        if (!response.ok) throw new Error('Request Failed!');
        setSelectedChat((prev) => ({
          ...prev,
          participants: prev.participants.filter((p) => p._id !== userId)
        }));
        setSelectedChat(null);
        socket.emit('participantLeft', { userId, chatId });
      })
      .catch((err) => console.log(err));
  }

  function handleDeleteChat(e) {
    e.preventDefault();
    fetch(`/api/chat/${encodeURIComponent(selectedChat._id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` }
    })
      .then((response) => {
        if (!response.ok) throw new Error('Request Failed!');
        setChats((prev) => prev.filter((chat) => chat._id !== selectedChat._id));
        setSelectedChat(null);
      })
      .catch((err) => console.error(err));
  }

  if (!selectedChat) return null;

  return (
    <div className={'chat-info-background-container' + chatInfoClass} ref={mediaContainerRef}>
      <div className={'chat-info-container' + chatInfoClass}>
        <div className="chat-info-heading">
          <div className="chat-img-container">
            <img className="chat-img" src={selectedChat.chatDp} alt="" />
            {String(user.id) === String(selectedChat.chatAdmin) &&
              <div className="photo-change-btn">
                <img
                  className="photo-change-img"
                  onClick={() => navigate(`/change-dp/cohortbox/${selectedChat._id}`)}
                  src={addPhoto}
                  alt=""
                />
              </div>
            }
          </div>
          <h4 className="chatname">{selectedChat.chatName}</h4>
        </div>

        <button className="media-toggle-btn">
          <p>See CohortBox Media</p>
          <p>{totalMedia}</p>
        </button>
        
        <div className="chat-info-media-container">
          {previewItems.length === 0 ? (
            <p style={{ opacity: 0.7, padding: "6px 0" }}>No media yet</p>
          ) : (
            <>
              {previewItems.map((item, index) => (
                <div
                  key={item.key}
                  className="chat-info-media"
                  onClick={() => openMediaViewer(index)}
                >
                  {item.type === "image" ? (
                    <img src={item.url} alt="" loading="lazy" />
                  ) : item.type === "video" ? (
                    <video src={item.url} preload="metadata" />
                  ) : (
                    <div className="media-preview-unsupported">File</div>
                  )}
                </div>
              ))}

              {/* last tile = See more */}
              { previewItems.length > PREVIEW_COUNT &&
                <button
                  type="button"
                  className="media-preview-more"
                  onClick={() => openMediaViewer(0)}
                >
                  <span>See more</span>
                  <span className="media-preview-more-count">
                    {Math.max((totalMedia ?? mediaItems.length) - previewItems.length, 0)}+
                  </span>
                </button>
              }
            </>
          )}

          <div ref={loadMoreMediaRef} style={{ height: 1 }} />
        </div>

        <div className="participants-heading-container">
          <h3 className={'participants-heading' + chatInfoClass}>Participants: </h3>
          {selectedChat.chatAdmin === user?.id && (
            <button className="add-participant-btn" onClick={() => setSearchBarClass('')}>
              <img src={addUserIcon} alt="" />
            </button>
          )}
        </div>

        <div className={'participant-names-container' + chatInfoClass}>
          {selectedChat.participants.map((participant, index) => (
            <Link to={`/profile/${participant._id}`} style={{ textDecoration: 'none', color: '#c5cad3' }}>
              <div key={index} className="chat-info-participant-container">
                <div className='chat-info-participant-dp-container'>
                  <div className='participant-img-container'>
                    <img src={participant.dp} />
                  </div>
                  <div className="chat-info-participant-name-container">
                    <p className={'participant-name' + chatInfoClass}>
                      {participant._id === user?.id ? 'You' : participant.firstName + ' ' + participant.lastName}
                    </p>
                    {selectedChat.chatAdmin === participant._id && <p className="admin">Admin</p>}
                  </div>
                </div>
                {selectedChat.chatAdmin === user?.id && participant._id !== user?.id && (
                  <button
                    className="participant-remove-btn"
                    onClick={(e) => handleRemove(e, participant._id, selectedChat._id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </Link>
          ))}
        </div>

        {selectedChat.participants.some((p) => p._id === user?.id) && selectedChat.chatAdmin !== user?.id && (
          <button className="leave-chat-btn" onClick={(e) => handleLeaveChat(e, user.id, selectedChat._id)}>
            <img src={leaveIcon} alt="" /> <p>Leave Cohort Box</p>
          </button>
        )}

        {selectedChat.chatAdmin === user?.id && (
          <button className={'delete-chat-btn' + chatInfoClass} onClick={handleDeleteChat}>
            Delete CohortBox
          </button>
        )}
      </div>

      {showMediaView && mediaItems.length > 0 && (
        <ChatInfoMediaView
          items={mediaItems}
          index={Math.min(activeMediaIndex, mediaItems.length - 1)}
          setShowMediaView={setShowMediaView}
          fetchMoreMedia={fetchMoreMedia}
          hasMoreMedia={hasMoreMedia}
          mediaLoading={mediaLoading}
          selectedChat={selectedChat}
        />
      )}

      <SearchBar
        searchBarClass={searchBarClass}
        setSearchBarClass={setSearchBarClass}
        members={members}
        setMembers={setMembers}
        chatId={selectedChat._id}
        addParticipant={true}
        selectedChat={selectedChat}
      />

      <div className={'chat-info-background' + chatInfoClass} onClick={() => setChatInfoClass(' hidden')}></div>
    </div>
  );
}

export default ChatInfo;
