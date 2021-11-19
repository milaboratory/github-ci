import {expect, test} from '@jest/globals'
import {canonizeVersion} from '../src/utils'

async function asyncCanonizeVersion(version: string) {
  return canonizeVersion(version)
}

test('check short version canonization', async () => {
  let v: string = canonizeVersion('1')
  expect(v).toBe('1.0.0')
})

test('check short version canonization 2', async () => {
  let v: string = canonizeVersion('1.10')
  expect(v).toBe('1.10.0')
})

test('check broken version canonization 1', async () => {
  await expect(asyncCanonizeVersion('1.1,0')).rejects.toThrow()
})

test('check broken version canonization 2', async () => {
  await expect(asyncCanonizeVersion('1.')).rejects.toThrow()
})

test('check broken version canonization 3', async () => {
  await expect(asyncCanonizeVersion('1.1a')).rejects.toThrow()
})

test('check broken version canonization 4', async () => {
  await expect(asyncCanonizeVersion('1.1.1.1')).rejects.toThrow()
})
