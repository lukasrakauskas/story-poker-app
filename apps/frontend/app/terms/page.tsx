import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Story Poker",
  description: "Terms for using Story Poker planning and retrospective tools.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8 sm:py-14">
      <article className="space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Terms of Service
          </h1>
          <p className="text-muted-foreground">
            These terms apply when you use Story Poker.
          </p>
        </header>

        <section className="space-y-2" aria-labelledby="using-service">
          <h2 id="using-service" className="text-xl font-semibold">
            Using the service
          </h2>
          <p className="leading-7 text-muted-foreground">
            Story Poker provides collaborative planning and retrospective tools.
            You are responsible for the content you enter and for sharing room
            links and passwords only with people you intend to invite.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="acceptable-use">
          <h2 id="acceptable-use" className="text-xl font-semibold">
            Acceptable use
          </h2>
          <p className="leading-7 text-muted-foreground">
            Do not misuse the service, interfere with its operation, attempt to
            access another person&apos;s private room, or submit unlawful,
            harmful, or abusive content.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="availability">
          <h2 id="availability" className="text-xl font-semibold">
            Availability and changes
          </h2>
          <p className="leading-7 text-muted-foreground">
            The service is provided as available. Features may change, and rooms
            or locally stored history may become unavailable. Keep a copy of any
            information you need to retain.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="warranty">
          <h2 id="warranty" className="text-xl font-semibold">
            Warranty and liability
          </h2>
          <p className="leading-7 text-muted-foreground">
            To the extent permitted by law, Story Poker is provided without
            warranties and is not liable for indirect loss, lost data, or
            interruption resulting from use of the service.
          </p>
        </section>
      </article>
    </main>
  );
}
