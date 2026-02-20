import './Posts.css'
import Post from './Post';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import FeedAd from './FeedAd.js';
import { useNavigate } from 'react-router-dom';

function Posts(){

    const [posts, setPosts] = useState([]);
    const { accessToken, loading } = useAuth();
    const navigate = useNavigate();
    
    useEffect(() => {
        if (!accessToken) return;
        if(loading) return;

        fetch(`/api/posts`, {
            method: 'GET',
            headers: {
                'authorization': `Bearer ${accessToken}`
            }
        }).then(response => {
            if(response.status === 404){
                return;
            }
            if(!response.ok){
                throw new Error('Request Failed!');
            }
            return response.json();
        }).then(data => {
            if (!data) {
                setPosts([]);
                return;
            }
            setPosts(data.posts)
        }).catch(err => {
            console.error(err);
            navigate('/crash')
        })
    },[accessToken])

    return (
        <div className='posts-page'>
            <div className='posts-container'>
                {
                    posts.map((post, index) => {
                        // 🟦 Otherwise just show a post
                        return <Post key={post._id} post={post} />;
                    })
                }
                
            </div>
        </div>
    )
}

export default Posts;