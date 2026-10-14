import { proxyProfileMediaUpload } from "../../../../../../lib/profile-media-proxy";
export const POST = (request: Request) => proxyProfileMediaUpload(request);
