import consola from "consola"
import { Hono } from "hono"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { forwardError } from "~/lib/error"
import { PATHS } from "~/lib/paths"

import { handleCompletion } from "./handler"

function getSystemMessageFromConfig(): string | null {
  try {
    const configPath = join(PATHS.APP_DIR, "system-prompt.txt")
    const content = readFileSync(configPath, "utf8").trim()
    return content || null
  } catch (error) {
    consola.debug(
      "No system-prompt.txt file found in global config directory:",
      error,
    )
    return null
  }
}

interface ChatMessage {
  role: string
  content: string
}

interface ChatCompletionBody {
  messages: Array<ChatMessage>
  [key: string]: unknown
}

function injectSystemMessage(body: ChatCompletionBody): ChatCompletionBody {
  const systemContent = getSystemMessageFromConfig()
  if (!systemContent) {
    return body
  }

  // Find the last system message index
  let lastSystemMessageIndex = -1
  for (let i = 0; i < body.messages.length; i++) {
    if (body.messages[i].role === "system") {
      lastSystemMessageIndex = i
    }
  }

  // Create the custom system message
  const customSystemMessage: ChatMessage = {
    role: "system",
    content: systemContent,
  }

  const newMessages: Array<ChatMessage> = [...body.messages]

  if (lastSystemMessageIndex === -1) {
    // No existing system message, add at the beginning
    newMessages.unshift(customSystemMessage)
    consola.debug("Added custom system message at the beginning")
  } else {
    // Insert after the last existing system message
    newMessages.splice(lastSystemMessageIndex + 1, 0, customSystemMessage)
    consola.debug(
      `Added custom system message after existing system message at index ${lastSystemMessageIndex}`,
    )
  }

  return {
    ...body,
    messages: newMessages,
  }
}

export const completionRoutes = new Hono()

completionRoutes.post("/", async (c) => {
  try {
    // Parse and modify the request body to inject system message
    const originalBody = (await c.req.json()) as unknown as ChatCompletionBody
    const modifiedBody = injectSystemMessage(originalBody)

    // Create a new request with the modified body
    const modifiedRequest = new Request(c.req.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: JSON.stringify(modifiedBody),
    })

    // Create a new context by copying properties without spread
    const modifiedContext = Object.assign(
      Object.create(Object.getPrototypeOf(c) as object),
      c as object,
      {
        req: modifiedRequest,
        json: () => Promise.resolve(modifiedBody),
      },
    ) as typeof c

    return await handleCompletion(modifiedContext)
  } catch (error) {
    return await forwardError(c, error)
  }
})
