import { ImageResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          height: "100%",
          width: "100%",
          fontWeight: 700,
          background: "hsl(224 71% 4%)",
        }}
      >
        <div
          style={{
            right: 50,
            bottom: 72,
            position: "absolute",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-start",
          }}
        >
          <span
            style={{
              fontSize: 20,
              color: "white",
            }}
          >
            story-poker.rake.lt
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "center",
            padding: "20px 50px",
            fontSize: 128,
            width: "75%",
            textAlign: "left",
            color: "white",
            lineHeight: 1.2,
          }}
        >
          <span
            style={{
              backgroundImage:
                "linear-gradient(90deg, rgb(255, 77, 77), rgb(249, 203, 40))",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Streamline estimation sessions
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
