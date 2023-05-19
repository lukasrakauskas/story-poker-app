import { Button, Header } from "ui";
import WebsocketImpl from "./websocket";

export default function Page() {
  return (
    <>
      <Header text="Web" />
      <Button />
      <WebsocketImpl />
    </>
  );
}
