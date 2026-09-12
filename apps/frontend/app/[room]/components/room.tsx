import { Cards } from "./cards";
import { InviteToRoom } from "./invite-to-room";

export function Room() {
  return (
    <main
      aria-label="Planning room"
      className="grid min-h-full gap-4 bg-muted/20 p-4 md:h-full md:min-h-0 md:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] lg:gap-6 lg:p-6"
    >
      <InviteToRoom />
      <Cards />
    </main>
  );
}
