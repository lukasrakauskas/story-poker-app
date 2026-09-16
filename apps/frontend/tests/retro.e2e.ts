import {
  advanceRetroPhase,
  expect,
  seedRetroAction,
  seedRetroNotes,
  test,
} from "./retro-fixtures";

test("completes a concise cross-phase retrospective with a live participant", async ({
  retro,
}) => {
  await retro.createRoom("Cross-phase happy path");
  const owner = retro.owner;
  const guest = await retro.joinParticipant("Bobby");

  await seedRetroNotes(owner.page, [
    { column: "went-well", text: "Teamwork was excellent" },
  ]);
  await seedRetroNotes(guest.page, [
    { column: "improve", text: "Reduce flaky tests" },
  ]);
  await expect(
    owner.page.getByText("Reduce flaky tests", { exact: true })
  ).toHaveCount(0);
  await expect(
    guest.page.getByText("Teamwork was excellent", { exact: true })
  ).toHaveCount(0);

  await advanceRetroPhase(owner.page, "Reveal and arrange notes");
  await expect(
    owner.page.getByText("Reduce flaky tests", { exact: true })
  ).toBeVisible();
  await advanceRetroPhase(owner.page, "Start voting");
  await guest.page
    .getByRole("button", {
      name: "Vote for note: Reduce flaky tests",
      exact: true,
    })
    .click();
  await expect(
    guest.page.getByRole("button", {
      name: "Remove vote from note: Reduce flaky tests",
      exact: true,
    })
  ).toHaveText("Voted");

  await advanceRetroPhase(owner.page, "Start discussion");
  await expect(owner.page.getByText("1 vote", { exact: true })).toBeVisible();
  await seedRetroAction(owner.page, "Pair on flaky tests", "Bobby");
  await expect(
    guest.page.getByText("Pair on flaky tests", { exact: true })
  ).toBeVisible();

  await advanceRetroPhase(owner.page, "Close retrospective");
  await expect(
    owner.page.getByRole("heading", {
      name: "Retrospective complete · read-only",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    owner.page.getByText("Pair on flaky tests", { exact: true })
  ).toBeVisible();
  await expect(
    guest.page.getByRole("heading", {
      name: "Retrospective complete · read-only",
      exact: true,
    })
  ).toBeVisible();
});
