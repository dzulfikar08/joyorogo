// www.joyorogo.com answers with a permanent redirect to the canonical host,
// keeping path and query.
const CANONICAL = "joyorogo.com";

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = CANONICAL;
    url.port = "";
    return Response.redirect(url.toString(), 301);
  },
};
