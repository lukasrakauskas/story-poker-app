import { Cards } from "./cards";
import { InviteToRoom } from "./invite-to-room";

export function Room() {
  return (
    <div className="p-4 min-h-screen grid md:grid-cols-12 gap-4">
      <div className="md:col-span-5 lg:col-span-4">
        <InviteToRoom />
      </div>
      <div className="md:col-span-7 lg:col-span-8">
        <Cards />
      </div>
    </div>
  );
}
