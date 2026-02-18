import './SignUp.css';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext'
import { useRef, useState } from 'react';


function SignUp() {

  const navigate = useNavigate();
  const { login, accessToken } = useAuth();
  const [usernameAvailable, setUsernameAvailable] = useState(null);
  const [password, setPassword] = useState('');
  const [showAboutDOB, setShowAboutDOB] = useState(false);
  const [about, setAbout] = useState('');
  const [DOB, setDOB] = useState('')
  const usernameTimerRef = useRef(null);

  function usernameCheck() {
    const usernameInput = document.getElementById("username");
    const username = usernameInput.value.trim();

    if(!/^[a-z0-9._]+$/.test(username)){
      usernameInput.borderColor = "red"
    }

    // ✅ clear old debounce timer (if user typed again)
    if (usernameTimerRef.current) {
      clearTimeout(usernameTimerRef.current);
    }

    // ✅ if empty, reset instantly (no API call)
    if (username === "") {
      usernameInput.style.borderColor = "";
      setUsernameAvailable(null);
      return;
    }

    // ✅ optional quick validation (no API call)
    if (username.length < 3) {
      usernameInput.style.borderColor = "red";
      setUsernameAvailable(false);
      return;
    }

    // ✅ debounce request by 500ms
    usernameTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/check-username?username=${encodeURIComponent(username)}`,
          {
            method: "GET",
            credentials: "include",
          }
        );

        const data = await res.json();

        if (res.ok && data.available === true) {
          usernameInput.style.borderColor = "green";
          setUsernameAvailable(true);
        } else {
          usernameInput.style.borderColor = "red";
          setUsernameAvailable(false);
        }
      } catch (err) {
        console.error("Username check failed:", err);
        usernameInput.style.borderColor = "red";
        setUsernameAvailable(false);
      }
    }, 500);
  }


  function Signup(e){
    e.preventDefault();

    const fNameInput = document.getElementById('fName');
    const lNameInput = document.getElementById('lName');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const usernameInput = document.getElementById('username');
    
    const username = usernameInput.value.trim();
    const fName = fNameInput.value.trim();
    const lName = lNameInput.value.trim();
    const email = emailInput.value.trim();

    if(!fName || !fName.trim()) { fNameInput.style.borderColor = 'red'; return }
    if(!lName || !lName.trim()) { lNameInput.style.borderColor = 'red'; return }
    if(!email || !email.trim()) { emailInput.style.borderColor = 'red'; return }
    if(!password || !password.trim() || password.length < 8) { passwordInput.style.borderColor = 'red'; return }
    if(!usernameAvailable) { usernameInput.style.borderColor = 'red'; return }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if(!emailRegex.test(email)){
      emailInput.style.borderColor = 'red';
      return;
    }



    fetch(`/api/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        firstName: fName,
        lastName: lName,
        email: email,
        password: password,
        username: username
      }),
      credentials: 'include'
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Sign Up failed with status ' + response.status, response.message);
      }
      return response.json();
    })
    .then(data => {
      console.log(data.message);
      console.log('Access Token:', data.accessToken);
      // Store token in localStorage or memory
      login(data.accessToken);
      setShowAboutDOB(true);
      console.log(showAboutDOB)
    })
    .catch(error => {
      console.error('Sign Up error:', error);
    });
  }

  function handleNext() {
    if(!accessToken) return;
    if (!DOB) {
      document.getElementById('dob').style.borderColor = 'red';
      return;
    }
    if (about || about.trim()) {
      fetch('/api/user/about', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          about: about.trim(),
        }),
      })
        .then(res => {
          if (!res.ok) throw new Error('Update failed');
        })
        .catch(err => {
          console.error(err);
        });
    }

    fetch('/api/user/dob', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        dob: DOB,
      }),
    }).then(res => {
      if(!res.ok) {
        throw new Error('Request Failed!');
      }
      navigate('/verify-email');
    }).catch(err => {
      console.error(err)
    })
  }

  function handleAbout(e) {
    const value = e.target.value;

    // Enforce 120 characters max
    if (value.length <= 120) {
      setAbout(value);
    }
  }

  return (
    <div className='SignUp'>
      <title>Signup - CohortBox</title>
        { !showAboutDOB ? 
          (<div className='signup-box'>
              <h1 className='signup-head'>Sign Up</h1>
              <form className='signup-form' onSubmit={Signup}>
                  <div className='signup-inputs-container'>
                      <input type='text' placeholder='First Name' className='signup-input' id='fName'/>
                      <input type='text' placeholder='Last Name' className='signup-input' id='lName'/>
                      <input type='text' placeholder='Email' className='signup-input' id='email'/>
                      <input type='password' placeholder='Password' onChange={(e) => setPassword(e.target.value)} value={password} className='signup-input' id='password'/>
                      <p>Your Password should be atleat 8 characters</p>
                      <input type='text' placeholder='Username' className='signup-input' id='username' onChange={usernameCheck}/>
                  </div>
                  <button type='submit' className='signup-btn' typeof='submit'>Create Account</button>
                  <Link to='/login' className='link-to-login'>Already have an account?</Link>
              </form>
          </div> ) : (
          <div className='about-dob-box'>
            <textarea onChange={handleAbout} value={about} placeholder='Tell us about yourself. (optional)' />
            <p>{about?.length || 0}/120</p>
            <div>
              <h1>Date of Birth:</h1>
              <input id='dob' type='date' onChange={(e) => setDOB(e.target.value)}/>
            </div>
            <button onClick={handleNext}>Next</button>
          </div> )
        }
    </div>
  );
}

export default SignUp;