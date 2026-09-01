import { clearInternalSessionCookie } from "../../internal-auth";

export async function GET() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/login",
      "Set-Cookie": clearInternalSessionCookie(),
    },
  });
}

export async function POST() {
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": clearInternalSessionCookie(),
      },
    },
  );
}
