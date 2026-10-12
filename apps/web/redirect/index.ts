// Old and alternate web hosts (joyorogo.dzulfikar.com, www.joyorogo.com) answer
// with a permanent redirect to the canonical host, keeping path and query, so
// links and search rankings move over to joyorogo.com.
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
