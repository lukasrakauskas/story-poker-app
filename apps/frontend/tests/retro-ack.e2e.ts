import {
  expect,
  holdNextRetroCommand,
  releaseHeldRetroCommand,
  seedRetroNotes,
  test,
} from "./retro-fixtures";

test("does not treat a peer broadcast as acknowledgement of a pending note", async ({
  retro,
}) => {
  await retro.createRoom("Command acknowledgement");
  const owner = retro.owner;
  const guest = await retro.joinParticipant("Bobby");

  await holdNextRetroCommand(owner.page, "add-note");
  await owner.page
    .getByLabel("Add a note", { exact: true })
    .first()
    .fill("Unsent owner note");
  await owner.page
    .getByRole("button", { name: "Add to went well", exact: true })
    .click();
  await expect(
    owner.page.getByRole("button", { name: "Add to went well", exact: true })
  ).toBeDisabled();

  await seedRetroNotes(guest.page, [
    { column: "improve", text: "Guest broadcast" },
  ]);
  await expect(
    owner.page.getByText("Guest broadcast", { exact: true })
  ).toHaveCount(0);
  await expect(
    owner.page.getByLabel("Add a note", { exact: true }).first()
  ).toHaveValue("Unsent owner note");

  await releaseHeldRetroCommand(owner.page);
  await expect(
    owner.page.getByText("Unsent owner note", { exact: true })
  ).toBeVisible();
  await expect(
    owner.page.getByLabel("Add a note", { exact: true }).first()
  ).toHaveValue("");
  await expect(
    guest.page.getByText("Unsent owner note", { exact: true })
  ).toHaveCount(0);
});
