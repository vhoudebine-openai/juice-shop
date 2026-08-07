/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import sinon from 'sinon'

import { downloadProfileImage } from '../../routes/profileImageUrlUpload'

describe('profileImageUrlUpload', () => {
  let uploadDirectory: string
  let fetchStub: sinon.SinonStub

  beforeEach(async () => {
    uploadDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'profile-image-url-upload-'))
    fetchStub = sinon.stub(global, 'fetch')
  })

  afterEach(async () => {
    fetchStub.restore()
    await fs.promises.rm(uploadDirectory, { recursive: true, force: true })
  })

  it('stores a bounded image response and supplies a download timeout', async () => {
    fetchStub.resolves(new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        'content-length': '3',
        'content-type': 'image/png'
      }
    }))

    const profileImage = await downloadProfileImage('https://example.com/image', 42, uploadDirectory)

    assert.equal(profileImage, '/assets/public/images/uploads/42.png')
    assert.deepEqual(await fs.promises.readFile(path.join(uploadDirectory, '42.png')), Buffer.from([1, 2, 3]))
    assert.ok(fetchStub.firstCall.args[1].signal instanceof AbortSignal)
  })

  it('rejects an oversized declared content length before creating a file', async () => {
    fetchStub.resolves(new Response(new Uint8Array([1]), {
      headers: {
        'content-length': '200001',
        'content-type': 'image/jpeg'
      }
    }))

    await assert.rejects(downloadProfileImage('https://example.com/image', 42, uploadDirectory), /oversized profile image/)
    assert.deepEqual(await fs.promises.readdir(uploadDirectory), [])
  })

  it('stops an oversized streamed response and removes its partial file', async () => {
    fetchStub.resolves(new Response(new Uint8Array(200001), {
      headers: { 'content-type': 'image/gif' }
    }))

    await assert.rejects(downloadProfileImage('https://example.com/image', 42, uploadDirectory), /oversized profile image/)
    assert.deepEqual(await fs.promises.readdir(uploadDirectory), [])
  })

  it('rejects unsupported response media types', async () => {
    fetchStub.resolves(new Response(new Uint8Array([1]), {
      headers: { 'content-type': 'text/html' }
    }))

    await assert.rejects(downloadProfileImage('https://example.com/image', 42, uploadDirectory), /unsupported profile image type/)
    assert.deepEqual(await fs.promises.readdir(uploadDirectory), [])
  })
})
