import { useState, useEffect, useRef } from "react";
import { useFloating, offset, flip } from "@floating-ui/react";
import dotsImg from "../images/dots.png";
import "./LiveCommentMenu.css";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";

function LiveCommentMenu({ selectedChat, comment }) {
    const { socket } = useSocket();
    const [open, setOpen] = useState(false);
    const { user } = useAuth();
    const isParticipant = selectedChat?.participants?.some(
        (p) => p._id === user.id
    );


    const { refs, floatingStyles } = useFloating({
        placement: "bottom-start",
        middleware: [offset(4), flip()],
    });

    const btnRef = refs.setReference;
    const menuRef = refs.setFloating;

    useEffect(() => {
        function handleClickOutside(e) {
            if (
                open &&
                refs.reference.current &&
                refs.floating.current &&
                !refs.reference.current.contains(e.target) &&
                !refs.floating.current.contains(e.target)
            ) {
                setOpen(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open, refs]);

    function handlePin(e){
        e.preventDefault();
        socket.emit('liveCommentPin', {chatId: selectedChat._id, comment});
        setOpen(false);
    }

    function handleReport(e){
        e.preventDefault();
    }

    return (
        <div className="lm-container">
            <button
                ref={btnRef}
                className="lm-btn"
                onClick={() => setOpen((prev) => !prev)}
            >
                <img className="lm-btn-img" src={dotsImg} alt="menu" />
            </button>

            {open && (
                <div ref={menuRef} style={floatingStyles} className="lm-menu-container">
                    {isParticipant &&
                        <button className="lm-inner-btn" onClick={handlePin}>Pin</button>
                    }
                    <button className="lm-inner-btn" onClick={handleReport}>Report</button>
                </div>
            )}
        </div>
    );
}

export default LiveCommentMenu;
