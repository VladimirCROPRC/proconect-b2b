import { finishOneDrive } from "../../../onedrive-server";
import { currentSession } from "../../../server-auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let result = "error";
  try {
    const session = await currentSession(request);
    const query = new URL(request.url).searchParams;
    if (session?.account.role === "Admin" && !session.account.passwordResetRequired && !query.has("error") && query.get("state") && query.get("code")) {
      await finishOneDrive(session.sessionId, query.get("state")!, query.get("code")!);
      result = "connected";
    }
  } catch { /* Never log authorization codes, tokens, or raw Microsoft error payloads. */ }
  return new Response(null, { status: 303, headers: { Location: `/?onedrive=${result}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
