import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testSnooze() {
  // Find the first intervention
  const intervention = await prisma.intervention.findFirst({
    where: { userId: { not: "" } }
  });
  
  if (!intervention) {
    console.log("No interventions found");
    process.exit(0);
  }

  console.log("Current intervention status:", intervention.status);
  
  // Reset it to pending if resolved
  if (intervention.status === 'resolved') {
    await prisma.intervention.update({
      where: { id: intervention.id },
      data: { 
        status: 'pending',
        resolvedAt: null
      }
    });
    console.log("Reset intervention to pending");
  }

  console.log("Intervention ID for testing:", intervention.id);
  console.log("User ID:", intervention.userId);
}

testSnooze()
  .finally(() => prisma.$disconnect());
