/** Close dangling markdown syntax so partial streams render cleanly (Claude-style). */
export function repairStreamingMarkdown(content: string): string {
  if (!content) return content;
  let text = content;

  const fenceCount = (text.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) {
    text += "\n```";
  }

  const boldCount = (text.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 === 1) {
    text += "**";
  }

  const outsideFences = text.replace(/```[\s\S]*?```/g, "").replace(/```[\s\S]*$/, "");
  const inlineCodeCount = (outsideFences.match(/`/g) ?? []).length;
  if (inlineCodeCount % 2 === 1) {
    text += "`";
  }

  return text;
}
