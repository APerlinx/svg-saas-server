import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const email = 'test@example.com'
  const password = 'Password123!'
  const name = 'TEST_USER'
  const credits = 50
  const plan = 'SUPPORTER'

  const hash = await bcrypt.hash(password, 10)

  await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash: hash, credits, plan },
    create: { email, name, passwordHash: hash, credits, plan },
  })
}

main()
  .finally(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
