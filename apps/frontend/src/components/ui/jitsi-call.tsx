import * as React from 'react';
import { Video } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

/**
 * Embedded video call for a consultation, via Jitsi Meet.
 *
 * DEMO/POC SCOPE — this uses Jitsi's public meet.jit.si instance, NOT a
 * self-hosted stack. Self-hosting needs ~4 containers plus JVB port/UDP work
 * (real infra, not a lean demo task), so the external SaaS dependency is
 * accepted here in the same way the DeepSeek AI-matching POC accepts one. Two
 * consequences worth stating plainly:
 *
 *  - The room is public to anyone holding the URL, and Jitsi's own moderation
 *    may apply. There is no JWT auth: that requires a paid or self-hosted
 *    setup and is deliberately out of scope.
 *  - Room names are unguessable-by-construction (see `roomNameFor`) rather
 *    than protected by an access control we do not have. That is the actual
 *    security boundary here; it is a demo boundary, not a clinical one.
 *
 * EMBED APPROACH — plain <iframe>, not the JitsiMeetExternalAPI script.
 * The External API means injecting a <script>, awaiting load, constructing an
 * object, and disposing it correctly across React re-renders and unmounts.
 * The iframe achieves the same "both parties land in the same room" outcome in
 * one element with none of that lifecycle surface, and the brief explicitly
 * left the choice open. If we later need programmatic control (mute, hangup
 * events, participant list), that is the point to migrate to the script API.
 */

/**
 * Build the Jitsi room name for a consultation.
 *
 * Derived from the session id so the two parties of ONE session compute the
 * same room without coordinating, and nobody else does. The session id is a
 * server-generated UUID, so the resulting name is not guessable — a stranger
 * cannot type a plausible room name and drop into someone else's consultation.
 *
 * Exported (and pure) so both the patient and doctor workspaces call this one
 * function: if the two sides derived the name independently, a drift between
 * them would silently put the pair in different calls.
 */
export function roomNameFor(sessionId: string): string {
  return `arai-consult-${sessionId}`;
}

/** Jitsi embed URL for a room, with the config we want pinned in the fragment. */
export function jitsiEmbedUrl(roomName: string): string {
  // `#config...` is Jitsi's documented way to pass options to the iframe embed
  // without the External API script.
  const config = [
    // Start with the camera off and let the user enable it — landing in a call
    // with your own video suddenly live is alarming, and most demo devices have
    // no working camera anyway.
    'config.startWithVideoMuted=true',
    // Audio, by contrast, is the point of the call. Left unmuted.
    'config.startWithAudioMuted=false',
    // No need to ask for a display name before entering a 1:1 demo room.
    'config.prejoinPageEnabled=false',
  ].join('&');

  return `https://meet.jit.si/${encodeURIComponent(roomName)}#${config}`;
}

/**
 * The call itself. Deliberately dumb: it renders the room and nothing else.
 *
 * `key={sessionId}` on the iframe means navigating between two different
 * consultations remounts the frame, rather than reusing the previous room's
 * document and stranding the user in the wrong call.
 */
export function JitsiCall({ sessionId }: { sessionId: string }) {
  const room = roomNameFor(sessionId);
  const src = React.useMemo(() => jitsiEmbedUrl(room), [room]);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Video className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-ink">Video call</p>
        </div>
        {/*
          Fixed height rather than an aspect ratio: Jitsi's iframe is unusable
          below roughly 400px of height (the toolbar overlaps the tiles), and a
          ratio-based box collapses unhelpfully on a short viewport.
        */}
        <iframe
          key={sessionId}
          src={src}
          title="Consultation video call"
          allow="camera; microphone; fullscreen; display-capture; autoplay"
          className="h-[480px] w-full border-0 bg-ink"
        />
      </CardContent>
    </Card>
  );
}
