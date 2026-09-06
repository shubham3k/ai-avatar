import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const { createDemoPipelineService } = await import(
    "../src/domain/pipeline.service.js"
  );
  const pipeline = createDemoPipelineService();
  const result = await pipeline.run();
  console.log("Demo setup complete:");
  console.log(`  signal created:       ${result.signalCreated}`);
  console.log(`  intervention created: ${result.interventionCreated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
