import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Music, VolumeX } from 'lucide-react';

const TRACKS = [
    { src: '/assets/music/grim-reaper.mp3', title: 'Grim Reaper — DEgITx' },
    { src: '/assets/music/burn-out.mp3', title: 'Burn Out — DEgITx' },
];

const LOBBY_TRACK = 0;
const GAME_TRACK = 1;

const MENU_VOLUME = 0.30;
const GAME_VOLUME = 0.20;
const FADE_IN_MS = 700;
const MUTE_KEY = 'transcendence-music-muted';

export default function BackgroundMusic() {
    const location = useLocation();

    const [muted, setMuted] = useState(() => {
        try {
            return localStorage.getItem(MUTE_KEY) === 'true';
        } catch {
            return false;
        }
    });

    const [trackIndex, setTrackIndex] = useState(LOBBY_TRACK);
    const [match, setMatch] = useState({ routeKey: '', state: '' });

    const trackRef = useRef(LOBBY_TRACK);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const levelRef = useRef(0);
    const unlockedRef = useRef(false);

    const inBattle = location.pathname === '/battle';

    const playingMatch =
        match.routeKey === location.key &&
        (match.state === 'ONGOING' || match.state === 'END');

    const desiredTrack = playingMatch ? GAME_TRACK : LOBBY_TRACK;

    const targetVolume = muted
        ? 0
        : inBattle
            ? (playingMatch ? GAME_VOLUME : 0)
            : MENU_VOLUME;

    // Listen for match state changes.
    useEffect(() => {
        const onMatchState = (event: Event) => {
            const state = (event as CustomEvent<unknown>).detail;

            if (
                typeof state === 'string' &&
                ['LOBBY', 'START', 'ONGOING', 'END'].includes(state)
            ) {
                setMatch({ routeKey: location.key, state });
            }
        };

        window.addEventListener('game:match-state', onMatchState);

        return () => {
            window.removeEventListener('game:match-state', onMatchState);
        };
    }, [location.key]);

    // Create one audio element that survives route changes.
    useEffect(() => {
        const audio = new Audio(TRACKS[LOBBY_TRACK].src);

        audio.preload = 'metadata';
        audio.loop = true;
        audio.volume = 0;

        audioRef.current = audio;

        const unlock = (event: Event) => {
            if (
                event.target instanceof Element &&
                event.target.closest('[data-music-toggle]')
            ) {
                return;
            }

            unlockedRef.current = true;

            if (levelRef.current > 0 && audio.paused) {
                void audio.play().catch(() => {});
            }
        };

        window.addEventListener('pointerdown', unlock, true);
        window.addEventListener('keydown', unlock, true);

        return () => {
            window.removeEventListener('pointerdown', unlock, true);
            window.removeEventListener('keydown', unlock, true);

            audio.pause();
            audio.removeAttribute('src');
            audio.load();

            if (audioRef.current === audio) {
                audioRef.current = null;
            }
        };
    }, []);

    // Switch between lobby and game tracks.
    useEffect(() => {
        const audio = audioRef.current;

        if (!audio || trackRef.current === desiredTrack) return;

        trackRef.current = desiredTrack;

        audio.pause();
        audio.volume = 0;
        audio.src = TRACKS[desiredTrack].src;
        audio.load();

        setTrackIndex(desiredTrack);

        if (unlockedRef.current && targetVolume > 0) {
            void audio.play().catch(() => {});
        }
    }, [desiredTrack, targetVolume]);

    // Control volume and fade-in.
    useEffect(() => {
        const audio = audioRef.current;

        levelRef.current = targetVolume;

        if (!audio) return;

        if (targetVolume === 0) {
            // Silence music during loading/countdown.
            audio.pause();
            audio.volume = 0;
            return;
        }

        if (unlockedRef.current) {
            void audio.play().catch(() => {});
        }

        const from = audio.volume;
        const start = performance.now();

        let frame = 0;

        const fade = (now: number) => {
            const progress = Math.min(
                1,
                Math.max(0, (now - start) / FADE_IN_MS)
            );

            audio.volume = from + (targetVolume - from) * progress;

            if (progress < 1) {
                frame = requestAnimationFrame(fade);
            }
        };

        frame = requestAnimationFrame(fade);

        return () => {
            cancelAnimationFrame(frame);
        };
    }, [targetVolume, trackIndex]);

    // Persist mute setting.
    useEffect(() => {
        try {
            localStorage.setItem(MUTE_KEY, String(muted));
        } catch {
            // Music still works without browser storage.
        }
    }, [muted]);

    const Icon = muted ? VolumeX : Music;

    return (
        <button
            type="button"
            className="fixed bottom-4 right-4 z-50 rounded-full border border-cyan-400/40 bg-[#0a0a14]/90 p-3 text-cyan-300 hover:bg-cyan-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            data-music-toggle
            aria-label={muted ? 'Enable music' : 'Mute music'}
            aria-pressed={muted}
            title={`${TRACKS[trackIndex].title}${muted ? ' (muted)' : ''}`}
            onClick={() => {
                // Keep playback request inside the click for autoplay rules.
                const audio = audioRef.current;

                if (muted && audio) {
                    unlockedRef.current = true;

                    void audio.play()
                        .then(() => {
                            if (levelRef.current === 0) {
                                audio.pause();
                            }
                        })
                        .catch(() => {});
                }

                setMuted(value => !value);
            }}
        >
            <Icon size={20} aria-hidden="true" />
        </button>
    );
}