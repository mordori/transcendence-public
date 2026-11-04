import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { bootEngine, getOrCreateCanvas, type EngineModule } from '../bootEngine';
import HUD from '../components/HUD';
import RageQuit from '@/components/RageQuit';
import GameCountdown from '../components/GameCountdown';
import GameResult from '@/components/GameResult';
import { requestGameTicket } from '@/lib/room-api';
import RoomErrorPage from '@/components/ErrorPage';

declare global {
    interface Window {
        __onMatchTimer?: (timerSeconds: number, countdownRemaining: number) => void;
        __onMatchScore?: (scoreRed: number, scoreBlue: number) => void;
        __onMatchState?: (state: string) => void;
    }
}

const IngameCanvas = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineModule = useRef<EngineModule | null>(null);
    const ticketRequest = useRef<{ roomId: string; promise: Promise<void> } | null>(null);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');
    const roomName = searchParams.get('name') ?? '';
    const [ticketReady, setTicketReady] = useState(false);
    const [ticketError, setTicketError] = useState<string | null>(null);
    const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
    const [timerSeconds, setTimerSeconds] = useState(0);
    const [score, setScore] = useState({ red: 0, blue: 0 });
    const [showResult, setShowResult] = useState(false);

    useEffect(() => {
        const onMatchTimer = (nextTimerSeconds: number, countdownRemaining: number) => {
            setTimerSeconds(nextTimerSeconds);
            setCountdownSeconds(countdownRemaining > 0 ? Math.ceil(countdownRemaining) : null);
        };

        window.__onMatchTimer = onMatchTimer;
        return () => {
            if (window.__onMatchTimer === onMatchTimer)
                delete window.__onMatchTimer;
        };
    }, []);

    useEffect(() => {
        const onMatchScore = (scoreRed: number, scoreBlue: number) => {
            setScore(prev =>
                prev.red === scoreRed && prev.blue === scoreBlue
                    ? prev
                    : { red: scoreRed, blue: scoreBlue }
            );
        };

        window.__onMatchScore = onMatchScore;
        return () => {
            if (window.__onMatchScore === onMatchScore)
                delete window.__onMatchScore;
        };
    }, []);

    useEffect(() => {
        const onMatchState = (state: string) => {
            window.dispatchEvent(new CustomEvent('game:match-state', { detail: state }));
            setShowResult(state === 'END');

            if (state === 'LOBBY') {
                // Disconnect C++ room socket before MatchLobby opens its socket (prevents 4002)
                engineModule.current?.ccall('game_leave_room', null, []);
                const params = new URLSearchParams({ name: roomName, id: roomId ?? '' });
                navigate(`/lobby?${params.toString()}`, { replace: true });
            }
        };
        window.__onMatchState = onMatchState;
        return () => {
            if (window.__onMatchState === onMatchState) delete window.__onMatchState;
        };
    }, [navigate, roomId, roomName]);

    useEffect(() => {
        if (!roomId) return;

        let disposed = false;
        const gameRoomId = roomId;
        if (ticketRequest.current?.roomId !== gameRoomId) {
            ticketRequest.current = {
                roomId: gameRoomId,
                promise: requestGameTicket(gameRoomId),
            };
        }
        const currentTicketRequest = ticketRequest.current;

        currentTicketRequest.promise.then(() => {
            if (!disposed) setTicketReady(true);
        }).catch((error: unknown) => {
            if (!disposed) {
                setTicketError(error instanceof Error ? error.message : 'Could not connect to the room.');
            }
        });

        return () => {
            disposed = true;
        };
    }, [roomId]);

    useEffect(() => {
        if (!ticketReady || !roomId || !containerRef.current) return;

        let disposed = false;
        const container = containerRef.current;
        const canvas = getOrCreateCanvas();
        container.prepend(canvas);

        bootEngine(canvas)
            .then(module => {
                if (disposed) return;
                engineModule.current = module;

                const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
                const wsUrl = `${protocol}://${window.location.host}/game?room=${encodeURIComponent(roomId)}`;
                module.ccall('game_join_room', 'number', ['string'], [wsUrl]);
            })
            .catch(console.error);

        return () => {
            disposed = true;
            // Cleanly leave room while #engine-canvas is still in the DOM so input callbacks unbind cleanly
            engineModule.current?.ccall('game_leave_room', null, []);
            if (canvas.parentNode === container) {
                container.removeChild(canvas);
            }
        };
    }, [ticketReady, roomId]);

    const handleQuit = () => {
        engineModule.current?.ccall('game_leave_room', null, []);
        navigate('/main-menu');
    };

    const connectionError = roomId ? ticketError : 'Room ID is missing.';
    if (connectionError) {
        return (
            <RoomErrorPage
                roomName={roomName}
                errorMessage={connectionError}
                onBack={() => navigate('/start-game', { replace: true })}
            />
        );
    }

    return (
        <div ref={containerRef} className="engine-container">
            <div className="ui" style={{ position: "relative", zIndex: 2 }}>
                <GameResult
                    show={showResult}
                    scoreRed={score.red}
                    scoreBlue={score.blue}
                />
                <GameCountdown secondsRemaining={countdownSeconds}/>
                <HUD timerSeconds={timerSeconds} scoreRed={score.red} scoreBlue={score.blue}/>
                <RageQuit onQuit={handleQuit} />
            </div>
        </div>
    );
};

export default IngameCanvas;
