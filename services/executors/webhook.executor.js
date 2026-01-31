export async function webhookExecutor(job) {
  const { url } = job.payload;

  if (!url) {
    throw new Error("Missing webhook URL");
  }

  console.log(`Calling webhook: ${url}`);
  await new Promise(resolve => setTimeout(resolve, 1500));
}
