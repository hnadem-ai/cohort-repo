import './LoadingMessages.css';

export default function LoadingMessages(){
    return (
        <div className='loading-messages-container'>
            <div className='my-loading-message'>
                <div className='dp'></div>
                <div className='msg-container short'></div>
            </div>
            <div className='my-loading-message'>
                <div className='dp'></div>
                <div className='msg-container long'></div>
            </div>
            <div className='other-loading-message'>
                <div className='dp'></div>
                <div className='msg-container short'></div>
            </div>
            <div className='other-loading-message'>
                <div className='dp'></div>
                <div className='msg-container short'></div>
            </div>
            <div className='other-loading-message'>
                <div className='dp'></div>
                <div className='msg-container long'></div>
            </div>
            <div className='other-loading-message'>
                <div className='dp'></div>
                <div className='msg-container long'></div>
            </div>
            <div className='my-loading-message'>
                <div className='dp'></div>
                <div className='msg-container short'></div>
            </div>
        </div>
    )
}