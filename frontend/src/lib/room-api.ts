// API call for getting the room list from data
export type RoomSummary = {
  id: string;
  name: string;
  locked: boolean;
  playerCount: number;
};

export async function getRoomList(): Promise<RoomSummary[]> {
  const response = await fetch('/api/rooms', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const result = await response.json().catch(() => null) as { rooms?: RoomSummary[]; error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? 'Could not load rooms.');
  return result?.rooms ?? [];
}

// API call for creating a room
export type CreatedRoom = {
  id: string;
  name: string;
  locked: boolean;
  playerCount: number;
};

type CreateRoomResponse = {
  room?: CreatedRoom;
  error?: string;
};

export async function createRoom(name: string, password: string | null): Promise<CreatedRoom> {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-auth-request': '1',
    },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({ name, password }),
  });

  const result = (await response.json().catch(() => null)) as CreateRoomResponse | null;
  if (!response.ok) {
    throw new Error(result?.error ?? 'Could not create room. Please try again.');
  }
  if (!result?.room) {
    throw new Error('The server returned an invalid room response.');
  }

  return result.room;
}

// API call for joining an existing room
export type JoinedRoom = {
  id: string
  name: string
  locked: boolean
  playerCount: number
}

type JoinRoomResponse = {
  room?: JoinedRoom
  error?: string
}

export async function joinRoom(roomId: string, password: string | null): Promise<JoinedRoom> {
  const response = await fetch(
    `/api/rooms/${encodeURIComponent(roomId)}/join`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-auth-request': '1',
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ password }),
    },
  )

  const result = (await response.json().catch(() => null)) as JoinRoomResponse | null
  if (!response.ok) {
    throw new Error(result?.error ?? 'Could not join room. Please try again.')
  }
  if (!result?.room) {
    throw new Error('The server returned an invalid room response.')
  }

  return result.room
}
export async function requestGameTicket(roomId: string): Promise<void> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/game-ticket`, {
    method: 'POST',
    headers: { 'x-auth-request': '1' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(result?.error ?? 'Could not connect to the room.');
  }
}
