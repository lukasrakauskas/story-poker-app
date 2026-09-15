import {
  advanceRetroPhase,
  createRetroTheme,
  expect,
  readRetroHistorySnapshot,
  seedRetroNotes,
  test,
} from "./retro-fixtures";

test("keeps writing and voting blind until discussion starts", async ({
  retro,
}) => {
  await retro.createRoom("Blind phases");
  const owner = retro.owner;
  const guest = await retro.joinParticipant("Bobby");
  await seedRetroNotes(owner.page, [
    { column: "went-well", text: "Private owner note" },
  ]);
  await seedRetroNotes(guest.page, [
    { column: "improve", text: "Private guest note" },
  ]);
  await expect(
    owner.page.getByText("Private guest note", { exact: true })
  ).toHaveCount(0);
  await expect(
    guest.page.getByText("Private owner note", { exact: true })
  ).toHaveCount(0);

  await advanceRetroPhase(owner.page, "Reveal and group notes");
  await createRetroTheme(
    owner.page,
    ["Private owner note", "Private guest note"],
    "One delivery theme"
  );
  await advanceRetroPhase(owner.page, "Start voting");
  await guest.page
    .getByRole("button", {
      name: "Vote for theme: One delivery theme",
      exact: true,
    })
    .click();

  await expect(owner.page.getByText("1 vote", { exact: true })).toHaveCount(0);
  await expect(
    guest.page.getByRole("button", {
      name: "Remove vote from theme: One delivery theme",
      exact: true,
    })
  ).toHaveText("Voted");
  const ownerSnapshot = await readRetroHistorySnapshot(owner.page);
  const guestSnapshot = await readRetroHistorySnapshot(guest.page);
  expect(ownerSnapshot.room.groups[0]).toMatchObject({
    title: "One delivery theme",
    voteCount: null,
    votedBySelf: false,
  });
  expect(guestSnapshot.room.groups[0]).toMatchObject({
    title: "One delivery theme",
    voteCount: null,
    votedBySelf: true,
  });
  expect(JSON.stringify(ownerSnapshot)).not.toContain("voterIds");
  expect(JSON.stringify(guestSnapshot)).not.toContain("voterIds");

  await advanceRetroPhase(owner.page, "Start discussion");
  await expect(owner.page.getByText("1 vote", { exact: true })).toBeVisible();
  await expect(guest.page.getByText("1 vote", { exact: true })).toBeVisible();
});
