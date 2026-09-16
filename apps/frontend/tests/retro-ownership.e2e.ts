import {
  advanceRetroPhase,
  expect,
  seedRetroNotes,
  test,
} from "./retro-fixtures";

test("keeps note editing private and gives deletion to the right owner", async ({
  retro,
}) => {
  await retro.createRoom("Note ownership");
  const owner = retro.owner;
  const guest = await retro.joinParticipant("Bobby");
  await seedRetroNotes(owner.page, [
    { column: "went-well", text: "Owner note" },
  ]);
  await seedRetroNotes(guest.page, [{ column: "improve", text: "Guest note" }]);

  const ownerActions = owner.page.getByRole("button", {
    name: "Actions for note: Owner note",
    exact: true,
  });
  await expect(ownerActions).toBeVisible();
  await expect(
    guest.page.getByRole("button", {
      name: "Actions for note: Owner note",
      exact: true,
    })
  ).toHaveCount(0);

  await ownerActions.click();
  await owner.page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await owner.page
    .getByLabel("Edit your note", { exact: true })
    .fill("Edited owner note");
  await owner.page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    owner.page.getByText("Edited owner note", { exact: true })
  ).toBeVisible();
  await expect(
    guest.page.getByText("Edited owner note", { exact: true })
  ).toHaveCount(0);

  await advanceRetroPhase(owner.page, "Reveal and arrange notes");
  await expect(
    owner.page.getByRole("button", {
      name: "Actions for note: Guest note",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    guest.page.getByRole("button", {
      name: "Actions for note: Guest note",
      exact: true,
    })
  ).toHaveCount(0);

  await owner.page
    .getByRole("button", {
      name: "Actions for note: Guest note",
      exact: true,
    })
    .click();
  await owner.page
    .getByRole("menuitem", { name: "Delete", exact: true })
    .click();
  const confirmation = owner.page.getByRole("alertdialog");
  await confirmation
    .getByRole("button", { name: "Delete note", exact: true })
    .click();
  await expect(owner.page.getByText("Guest note", { exact: true })).toHaveCount(
    0
  );
  await expect(guest.page.getByText("Guest note", { exact: true })).toHaveCount(
    0
  );
});
