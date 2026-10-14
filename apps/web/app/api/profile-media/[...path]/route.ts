import { proxyProfileMedia } from "../../../../lib/profile-media-proxy";
export const GET = (request: Request) => proxyProfileMedia(request);
