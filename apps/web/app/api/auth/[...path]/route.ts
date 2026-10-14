import { proxyAccount } from "../../../../lib/account-proxy";
export const GET = (request: Request) => proxyAccount(request);
export const POST = (request: Request) => proxyAccount(request);
