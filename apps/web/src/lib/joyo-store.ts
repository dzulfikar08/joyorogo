import { createChatStore } from "@joyorogo/api/lib/joyo-ai/conversations";

import { localKeyValue } from "./joyo-chat";

/** The Joyo AI conversations of this browser (30 chats of 80 messages): localStorage only, never synced and never sent anywhere but as the turns of a question. */
export const joyoChats = createChatStore(localKeyValue);
