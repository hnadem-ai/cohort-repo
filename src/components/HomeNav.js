import './HomeNav.css';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import searchIcon from '../images/magnifying-glass.png';
import NavChatButton from './NavChatButton';
import NavUserButton from './NavUserButton';
import { useAuth } from '../context/AuthContext';
import { useSocketEvent } from '../context/SocketContext';
import close from '../images/close-gray.png'
import Toast from './Toast';

function ChatsNav({ users, setUsers, chats, setChats, selectedChat, setSelectedChat, userChats, setUserChats, isNewMessage, setIsNewMessage, setNewMessageChatIds, newMessageChatIds }) {
  const { user, accessToken, loading } = useAuth();
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [currFilter, setCurrFilter] = useState('cb');
  const [searchInput, setSearchInput] = useState('');
  const [searchUsers, setSearchUsers] = useState([]);
  const [searchChats, setSearchChats] = useState([]);
  const [toastMsg, setToastMsg] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [searchState, setSearchState] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasMoreChats, setHasMoreChats] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [hasMoreUsers, setHasMoreUsers] = useState(true);
  const [userLoading, setUserLoading] = useState(false);

  // sub pagination
  const [subscribedChats, setSubscribedChats] = useState([]);
  const [hasMoreSubs, setHasMoreSubs] = useState(true);
  const [subLoading, setSubLoading] = useState(false);

  // my pagination
  const [hasMoreMy, setHasMoreMy] = useState(true);
  const [myLoading, setMyLoading] = useState(false);

  const navigate = useNavigate();

  const chatsContainerRef = useRef(null);
  const loadMoreChatsRef = useRef(null);
  const loadMoreUsersRef = useRef(null);
  const loadMoreSubsRef = useRef(null);
  const loadMoreMyRef = useRef(null);
  const subInFlightRef = useRef(false);
  const myInFlightRef = useRef(false);
  const LIMIT = 30;

  const fetchMoreChats = useCallback(async () => {
    if (!accessToken || loading) return;
    if (chatLoading || !hasMoreChats || chats.length < 30) return;
    if (searchState || currFilter !== 'cb') return; // only lazy-load when showing chats list

    setChatLoading(true);

    const lastId = chats?.length ? chats[chats.length - 1]._id : null;

    try {
      const url = lastId
        ? `/api/chats?lastId=${encodeURIComponent(lastId)}`
        : `/api/chats`;

      const res = await fetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        credentials: 'include'
      });

      // your backend returns 404 when no chats found
      if (res.status === 404) {
        setHasMoreChats(false);
        setChatLoading(false);
        return;
      }

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data = await res.json();
      const newChats = data?.chats || [];

      if (newChats.length === 0) {
        setHasMoreChats(false);
      } else {
        // ✅ prevent duplicates (important if observer fires twice)
        const existing = new Set((chats || []).map(c => String(c._id)));
        const deduped = newChats.filter(c => !existing.has(String(c._id)));

        if (deduped.length === 0) {
          setHasMoreChats(false);
        } else {
          setChats(prev => [...prev, ...deduped]);
        }
      }
    } catch (err) {
      console.error(err.message || 'Failed to load chats');
      navigate('/crash')
    } finally {
      setChatLoading(false);
    }
  }, [accessToken, loading, chatLoading, hasMoreChats, searchState, currFilter, chats, setChats]);

  const fetchMoreUsers = useCallback(async () => {
    if (!accessToken || loading) return;

    // Only lazy-load when showing the People list (and not searching)
    if (searchState || currFilter !== 'people') return;

    // Prevent double fetches
    if (userLoading || !hasMoreUsers) return;

    // Optional: only paginate if you already loaded one full page
    if (users.length > 0 && users.length < 30) return;

    setUserLoading(true);

    const lastId = users?.length ? users[users.length - 1]._id : null;

    try {
      const url = lastId
        ? `/api/users?lastId=${encodeURIComponent(lastId)}`
        : `/api/users`;

      const res = await fetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        credentials: 'include'
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data = await res.json();
      const newUsers = data?.users || [];

      if (newUsers.length === 0) {
        setHasMoreUsers(false);
        return;
      }

      const existing = new Set((users || []).map(u => String(u._id)));
      const deduped = newUsers.filter(u => !existing.has(String(u._id)));

      if (deduped.length === 0) {
        setHasMoreUsers(false);
      } else {
        setUsers(prev => [...prev, ...deduped]);
      }
    } catch (err) {
      console.error(err.message || 'Failed to load users');
      navigate('/crash');
    } finally {
      setUserLoading(false);
    }
  }, [
    accessToken,
    loading,
    searchState,
    currFilter,
    userLoading,
    hasMoreUsers,
    users,
    setUsers
  ]);

  const fetchMoreSubscribedChats = useCallback(async () => {
    if (!accessToken || loading) return;
    if (searchState || currFilter !== 'sub') return;

    // ✅ blocks double-fire before state updates
    if (subInFlightRef.current || subLoading || !hasMoreSubs) return;

    subInFlightRef.current = true;
    setSubLoading(true);

    const lastId = subscribedChats.length
      ? subscribedChats[subscribedChats.length - 1]._id
      : null;

    try {
      const url = lastId
        ? `/api/subscribed-chats?lastId=${encodeURIComponent(lastId)}`
        : `/api/subscribed-chats`;

      const res = await fetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        credentials: 'include'
      });

      if (res.status === 404) {
        setHasMoreSubs(false);
        return;
      }
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data = await res.json();
      const newChats = data?.chats || [];

      // ✅ IMPORTANT: if server returns less than LIMIT, stop pagination
      if (newChats.length < LIMIT) setHasMoreSubs(false);

      const existing = new Set(subscribedChats.map(c => String(c._id)));
      const deduped = newChats.filter(c => !existing.has(String(c._id)));

      if (deduped.length > 0) {
        setSubscribedChats(prev => [...prev, ...deduped]);
      } else if (newChats.length === 0) {
        setHasMoreSubs(false);
      }
    } catch (err) {
      console.error(err.message || 'Failed to load subscribed chats');
      navigate('/crash');
    } finally {
      setSubLoading(false);
      subInFlightRef.current = false;
    }
  }, [accessToken, loading, searchState, currFilter, subLoading, hasMoreSubs, subscribedChats, navigate]);

  const fetchMoreMyChats = useCallback(async () => {
    if (!accessToken || loading) return;
    if (!user?.id) return;
    if (searchState || currFilter !== 'my') return;

    if (myInFlightRef.current || myLoading || !hasMoreMy) return;

    myInFlightRef.current = true;
    setMyLoading(true);

    const lastId = userChats.length ? userChats[userChats.length - 1]._id : null;

    try {
      const url = lastId
        ? `/api/user-chats/${encodeURIComponent(user.id)}?lastId=${encodeURIComponent(lastId)}`
        : `/api/user-chats/${encodeURIComponent(user.id)}`;

      const res = await fetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        credentials: 'include'
      });

      if (res.status === 404) {
        setHasMoreMy(false);
        return;
      }
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data = await res.json();
      const newChats = data?.chats || [];

      if (newChats.length < LIMIT) setHasMoreMy(false);

      const existing = new Set(userChats.map(c => String(c._id)));
      const deduped = newChats.filter(c => !existing.has(String(c._id)));

      if (deduped.length > 0) {
        setUserChats(prev => [...prev, ...deduped]);
      } else if (newChats.length === 0) {
        setHasMoreMy(false);
      }
    } catch (err) {
      console.error(err.message || 'Failed to load my chats');
      navigate('/crash');
    } finally {
      setMyLoading(false);
      myInFlightRef.current = false;
    }
  }, [accessToken, loading, user?.id, searchState, currFilter, myLoading, hasMoreMy, userChats, navigate]);

  function showAlert(msg) {
    setToastMsg(msg);
    setShowToast(true);
  }


  async function handleSearch(e) {
    try {
      e.preventDefault();
      if (searchInput.trim() === '') return;
      if (searchInput.length < 2) {
        showAlert('Please Search with more than 2 letters');
        return;
      }

      const result = await fetch(`/api/search?q=${encodeURIComponent(searchInput)}`, {
        method: 'GET',
        headers: {
          'authorization': `Bearer ${accessToken}`
        }
      })

      if (!result.ok) {
        showAlert('Search was Unsuccessful!');
        return;
      }
      const { chats, users } = await result.json();
      setSearchQuery(searchInput);
      setSearchChats(chats);
      setSearchUsers(users);
      setSearchState(true);
    } catch (err) {
      console.error(err);
      navigate('/crash')
    }
  }


  useEffect(() => {
    if (!accessToken || loading) return;
    if (currFilter !== 'cb') return;
    if (!chats || chats.length === 0) fetchMoreChats();
  }, [accessToken, loading]);

  useEffect(() => {
    if (!accessToken || loading) return;
    if (currFilter !== ' people') return;
    if (!users || users.length === 0) fetchMoreUsers();
  }, [accessToken, loading, currFilter]);

  useEffect(() => {
    if (!accessToken || loading) return;
    if (currFilter !== 'sub') return;
    if (!subscribedChats || subscribedChats.length === 0) fetchMoreSubscribedChats();
  }, [accessToken, loading, currFilter, subscribedChats?.length]);

  useEffect(() => {
    if (!accessToken || loading) return;
    if (currFilter !== 'my') return;
    if (!userChats || userChats.length === 0) fetchMoreMyChats();
  }, [accessToken, loading, currFilter, userChats?.length]);


  useEffect(() => {
    if (!loadMoreChatsRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchMoreChats();
        }
      },
      {
        root: chatsContainerRef.current, // ✅ observe inside the scroll container
        rootMargin: "200px",
        threshold: 0
      }
    );

    observer.observe(loadMoreChatsRef.current);
    return () => observer.disconnect();
  }, [fetchMoreChats]);

  useEffect(() => {
    if (!loadMoreUsersRef.current) return;
    if (searchState || currFilter !== 'people') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchMoreUsers();
        }
      },
      {
        root: chatsContainerRef.current, // ✅ observe inside the scroll container
        rootMargin: "200px",
        threshold: 0
      }
    );

    observer.observe(loadMoreUsersRef.current);
    return () => observer.disconnect();
  }, [fetchMoreUsers]);

  useEffect(() => {
    if (!loadMoreSubsRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchMoreSubscribedChats();
      },
      { root: chatsContainerRef.current, rootMargin: "200px", threshold: 0 }
    );

    observer.observe(loadMoreSubsRef.current);
    return () => observer.disconnect();
  }, [fetchMoreSubscribedChats]);

  useEffect(() => {
    if (!loadMoreMyRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchMoreMyChats();
      },
      { root: chatsContainerRef.current, rootMargin: "200px", threshold: 0 }
    );

    observer.observe(loadMoreMyRef.current);
    return () => observer.disconnect();
  }, [fetchMoreMyChats]);


  useEffect(() => {
    if (!accessToken || loading) return;
    fetch(`/api/friends`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    })
      .then(r => {
        if (!r.ok) {
          if (r.status === 404) {
            setFriends([]);
            return;
          }
          throw new Error('Request Failed with Status: ' + r.status);
        }
        return r.json();
      })
      .then(data => data && setFriends(data.friends || []))
      .catch(err => {
        console.error('Error fetching friends:', err);
        navigate('/crash');
      });
  }, [accessToken, loading]);

  useEffect(() => {
    if (!accessToken || loading) return;
    fetch(`/api/friend-requests`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    })
      .then(r => {
        if (!r.ok) throw new Error('Request Failed with Status: ' + r.status);
        return r.json();
      })
      .then(data => setFriendRequests(data.requests || []))
      .catch(err => {
        console.error('Error fetching friend requests:', err);
        navigate('/crash');
      });
  }, [accessToken, loading]);

  useSocketEvent(
    'friendRequestSent',
    (request) => {
      setFriendRequests(prev => [...prev, request]);
    },
    [user]
  );

  useSocketEvent(
    'friendRequestReceived',
    (request) => {
      setFriendRequests(prev => [...prev, request]);
    },
    [user]
  );

  useSocketEvent(
    'friendRequestCanceled',
    ({ from, to }) => {
      setFriendRequests(prev =>
        prev.filter(fr => !(String(fr.from._id) === String(from) && String(fr.to._id) === String(to)))
      );
    },
    [user]
  );

  useSocketEvent(
    'friendRequestAccepted',
    ({ from, to, friendObj }) => {
      setFriendRequests(prev =>
        prev.filter(fr => !(String(fr.from._id) === String(from) && String(fr.to._id) === String(to)))
      );
      setFriends(prev => [...prev, friendObj])
    },
    [user]
  );

  useSocketEvent(
    'friendRequestRejected',
    ({ from, to }) => {
      setFriendRequests(prev =>
        prev.filter(fr => !(String(fr.from._id) === String(from) && String(fr.to._id) === String(to)))
      );
    },
    [user]
  );

  useSocketEvent(
    'unfriend',
    (userId) => {
      setFriends(prev =>
        prev.filter(friend => !(String(friend._id) === String(userId)))
      );
    },
    [user]
  );


  const friendIds = useMemo(
    () => new Set(friends.map(f => String(f._id))),
    [friends]
  );

  const outgoingPending = useMemo(
    () =>
      new Set(
        friendRequests
          .filter(r => String(r.from._id) === String(user?.id) && r.status === 'pending')
          .map(r => String(r.to._id))
      ),
    [friendRequests, user?.id]
  );

  const incomingPending = useMemo(
    () =>
      new Set(
        friendRequests
          .filter(r => String(r.to._id) === String(user?.id) && r.status === 'pending')
          .map(r => String(r.from._id))
      ),
    [friendRequests, user?.id]
  );

  return (
    <div className='cn-container'>
      <div className='cn-heading-container'>
        <h3 className='cn-heading'>MY COHORT BOXES</h3>
      </div>

      <div className='cn-body-container'>
        <div className='cn-searchbar-container'>
          <img className='cn-search-icon' src={searchIcon} />
          <form className='form' onSubmit={handleSearch}>
            <input className='cn-search-input' placeholder='Search Cohortian/CohortBox' value={searchInput} onInput={(e) => setSearchInput(e.target.value)} />
          </form>
        </div>

        <div className='cn-filter-container'>
          <button className={'cn-filter-btn' + (currFilter === 'cb' ? ' active-filter-btn' : '')} onClick={() => setCurrFilter('cb')}>Cohortboxes</button>
          <button className={'cn-filter-btn' + (currFilter === 'people' ? ' active-filter-btn' : '')} onClick={(e) => { e.preventDefault(); setCurrFilter('people') }}>People</button>
          <button className={'cn-filter-btn' + (currFilter === 'sub' ? ' active-filter-btn' : '')} onClick={(e) => { e.preventDefault(); setCurrFilter('sub') }}>Subscriptions</button>
          <button className={'cn-filter-btn' + (currFilter === 'my' ? ' active-filter-btn' : '')} onClick={(e) => { e.preventDefault(); setCurrFilter('my'); setIsNewMessage(false) }}>My Cohortboxes { isNewMessage && <div className='new-indicator'></div>}</button>
        </div>

        <div className='cn-chats-container' ref={chatsContainerRef}>
          {
            searchState && (
              <div className='search-heading'>
                <p>{`search '${searchQuery}'`}</p>
                <img src={close} onClick={() => setSearchState(false)} />
              </div>
            )
          }
          {
            /* ================= SEARCH MODE ================= */
            searchState && currFilter === 'cb' && (
              searchChats.map(chat => (
                <NavChatButton
                  key={chat._id || chat.id}
                  chat={chat}
                  selectedChat={selectedChat}
                  setSelectedChat={setSelectedChat}
                />
              ))
            )
          }

          {
            searchState && currFilter !== 'cb' && (
              searchUsers.map(u => {
                const id = String(u._id);
                const isFriend = friendIds.has(id);
                const sentRequest = outgoingPending.has(id);
                const gotRequest = incomingPending.has(id);

                return (
                  <Link
                    to={'/profile/' + u._id}
                    style={{ textDecoration: 'none' }}
                    key={u._id}
                  >
                    <NavUserButton
                      user={u}
                      isFriend={isFriend}
                      sentRequest={sentRequest}
                      gotRequest={gotRequest}
                    />
                  </Link>
                );
              })
            )
          }

          {
            /* ================= NORMAL MODE ================= */
            !searchState && currFilter === 'cb' && (
              <>
                {
                  chats.length === 0 && (
                    <p className='empty-para'>No chats to show right now!</p>
                  )
                }

                {chats.map(chat => (
                  <NavChatButton
                    key={chat._id || chat.id}
                    chat={chat}
                    selectedChat={selectedChat}
                    setSelectedChat={setSelectedChat}
                  />
                ))}

                {chatLoading && (
                  <p style={{ padding: '8px', opacity: 0.8, color: '#c5cad3' }}>
                    Loading more...
                  </p>
                )}

                {!chatLoading && !hasMoreChats && chats.length > 0 && (
                  <p style={{ padding: '8px', opacity: 0.6 }}>
                    No more chats
                  </p>
                )}

                <div ref={loadMoreChatsRef} style={{ height: 1 }} />
              </>
            )
          }

          {
            !searchState && currFilter === 'people' && (
              <>
                {
                  users.length === 0 && (
                    <p className='empty-para'>No Users to show right now!</p>
                  )
                }

                {users.map(u => {
                  const id = String(u._id);
                  const isFriend = friendIds.has(id);
                  const sentRequest = outgoingPending.has(id);
                  const gotRequest = incomingPending.has(id);

                  return (
                    <Link
                      to={'/profile/' + u._id}
                      style={{ textDecoration: 'none' }}
                      key={u._id}
                    >
                      <NavUserButton
                        user={u}
                        isFriend={isFriend}
                        sentRequest={sentRequest}
                        gotRequest={gotRequest}
                      />
                    </Link>
                  );
                })}

                {userLoading && (
                  <p style={{ padding: '8px', opacity: 0.8, color: '#c5cad3' }}>
                    Loading more...
                  </p>
                )}

                {!userLoading && !hasMoreUsers && users.length > 0 && (
                  <p style={{ padding: '8px', opacity: 0.6 }}>
                    No more users
                  </p>
                )}

                <div ref={loadMoreUsersRef} style={{ height: 1 }} />
              </>
            )
          }

          {
            !searchState && currFilter === 'sub' && (
              <>
                {
                  subscribedChats.length === 0 && (
                    <p className='empty-para'>You have not subscribed to any chats!</p>
                  )
                }

                {subscribedChats.map(chat => (
                  <NavChatButton
                    key={chat._id || chat.id}
                    chat={chat}
                    selectedChat={selectedChat}
                    setSelectedChat={setSelectedChat}
                  />
                ))}

                {subLoading && (
                  <p style={{ padding: '8px', opacity: 0.8, color: '#c5cad3' }}>
                    Loading more...
                  </p>
                )}

                <div ref={loadMoreSubsRef} style={{ height: 1 }} />
              </>
            )
          }

          {
            !searchState && currFilter === 'my' && (
              <>
                {
                  userChats.length === 0 && (
                    <p className='empty-para'>You are not a part of any chat!</p>
                  )
                }

                {userChats.map(chat => (
                  <NavChatButton
                    key={chat._id || chat.id}
                    chat={chat}
                    selectedChat={selectedChat}
                    setSelectedChat={setSelectedChat}
                    setNewMessageChatIds={setNewMessageChatIds}
                    newMessageChatIds={newMessageChatIds}
                  />
                ))}

                {myLoading && (
                  <p style={{ padding: '8px', opacity: 0.8, color: '#c5cad3' }}>
                    Loading more...
                  </p>
                )}

                <div ref={loadMoreMyRef} style={{ height: 1 }} />
              </>
            )
          }

        </div>
      </div>
      <Toast
        message={toastMsg}
        show={showToast}
        onClose={() => setShowToast(false)}
      />
    </div>
  );
}

export default ChatsNav;
