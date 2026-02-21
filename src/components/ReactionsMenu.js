import "./ReactionsMenu.css";
import { useEffect, useMemo, useState } from "react";
import { useFloating, offset, flip, shift } from "@floating-ui/react";

export default function ReactionsPopup({ reactions = [], selectedChat, isCimv = false }) {
    const [open, setOpen] = useState(false);

    const { refs, floatingStyles } = useFloating({
        placement: "top",
        middleware: [offset(4), flip(), shift({ padding: 8 })],
    });

    // ✅ participant id set
    // Create map of participantId -> full participant object
    const participantMap = useMemo(() => {
        const map = new Map();

        (selectedChat?.participants || []).forEach(p => {
            const id = String(p?._id ?? p);
            map.set(id, p);
        });

        return map;
    }, [selectedChat?._id, selectedChat?.participants]);


    // Replace reaction.userId with full participant object
    const participantReactions = useMemo(() => {
        return (reactions || [])
            .map(r => {
                const uid = String(r?.userId?._id ?? r?.userId);
                const participant = participantMap.get(uid);

                if (!participant) return null;

                return {
                    ...r,
                    userId: participant // 🔥 replace with full object
                };
            })
            .filter(Boolean);
    }, [reactions, participantMap]);

    const allTopEmojis = useMemo(() => {
        const grouped = (reactions || []).reduce((acc, r) => {
            if (!r?.emoji) return acc;
            acc[r.emoji] = (acc[r.emoji] || 0) + 1;
            return acc;
        }, {});

        return Object.entries(grouped)
            .map(([emoji, count]) => ({ emoji, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }, [reactions]);

    // ✅ group for top emojis + total count (based on filtered)
    const { list, topEmojis, totalCount } = useMemo(() => {
        const grouped = reactions.reduce((acc, r) => {
            acc[r.emoji] = (acc[r.emoji] || 0) + 1;
            return acc;
        }, {});
        const list = Object.entries(grouped).map(([emoji, count]) => ({ emoji, count }));
        return { list, topEmojis: list.slice(0, 5), totalCount: reactions.length };
    }, [reactions]);

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

    return (
        <div className="reactions-popup-root">
            <button
                ref={refs.setReference}
                type="button"
                className="reactions-trigger"
                onClick={() => setOpen(prev => !prev)}
            >
                <span className={isCimv ? "reaction-bubble is-cimv" : 'reaction-bubble'}>
                    {allTopEmojis.slice(0,2).map(e => <span key={e.emoji}>{e.emoji}</span>)}
                    <span className="reaction-count">{totalCount}</span>
                </span>
            </button>

            {open && (
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    className="reactions-popup-menu"
                >
                    <div className="reactions-popup-title">Reactions</div>

                    <div className="total-reactions">
                        <div className="total-reactions-emojis">
                            {allTopEmojis.map(e => <span key={e.emoji}>{e.emoji}</span>)}
                        </div>
                        <span className="total-reactions-count">{totalCount}</span>
                    </div>

                    <div className="reactions-popup-list">
                        {participantReactions.map((item, idx) => (
                            <div
                                key={`${String(item.userId?._id ?? item.userId)}-${item.emoji}-${idx}`}
                                className="reactions-popup-row"
                            >
                                <span className="reactions-popup-username">
                                    {item.userId?.username || "Unknown"}
                                </span>
                                <span className="reactions-popup-emoji">{item.emoji}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
