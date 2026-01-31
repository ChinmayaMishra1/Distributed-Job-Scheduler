export async function emailExecutor(job) {
  const { to } = job.payload;

  if (!to) {
    throw new Error("Missing email recipient");
  }

  console.log(`Sending email to ${to}`);
  await new Promise(resolve => setTimeout(resolve, 2000));
}
