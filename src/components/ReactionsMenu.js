// components/ReactionsPopup.jsx
import './ReactionsMenu.css';
import { useEffect, useState } from "react";
import { useFloating, offset, flip, shift } from "@floating-ui/react";

export default function ReactionsPopup({ reactions = [] }) {
    const [open, setOpen] = useState(false);

    const { refs, floatingStyles } = useFloating({
        placement: "top",
        middleware: [offset(4), flip(), shift({ padding: 8 })],
    });

    // group counts
    const grouped = reactions.reduce((acc, r) => {
        acc[r.emoji] = (acc[r.emoji] || 0) + 1;
        return acc;
    }, {});

    const list = Object.entries(grouped).map(([emoji, count]) => ({ emoji, count }));
    const topEmojis = list.slice(0, 5);

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

    if (!reactions || reactions.length === 0) return null;

    return (
        <div className="reactions-popup-root">
            {/* Trigger = reactions bubble */}
            <button
                ref={refs.setReference}
                type="button"
                className="reactions-trigger"
                onClick={() => setOpen(prev => !prev)}
            >
                <span className="reaction-bubble">
                    <span>{list[0]?.emoji}</span>
                    {list[1] && <span>{list[1].emoji}</span>}
                    {reactions.length > 1 && <span className="reaction-count">{reactions.length}</span>}
                </span>
            </button>

            {open && (
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    className="reactions-popup-menu"
                >
                    <div className="reactions-popup-title">Reactions</div>
                    <div className='total-reactions'>
                        <div className='total-reactions-emojis'>
                            {
                                list.slice(0, 5).map(e => <span key={e.emoji}>{e.emoji}</span>)
                            }
                        </div>
                        <span className='total-reactions-count'>{reactions.length}</span>
                    </div>
                        <div className="reactions-popup-list">
                            {reactions.map(item => (
                                <div key={item.emoji} className="reactions-popup-row">
                                    <span className="reactions-popup-username">{item.userId.username}</span>
                                    <span className="reactions-popup-emoji">{item.emoji}</span>
                                </div>
                            ))}
                        </div>
                    </div>
      )}
                </div>
            );
}
