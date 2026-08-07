/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { type Request, type Response, type NextFunction } from 'express'

import * as security from '../lib/insecurity'
import { UserModel } from '../models/user'
import * as utils from '../lib/utils'
import logger from '../lib/logger'

const maxProfileImageSize = 200000
const profileImageDownloadTimeout = 5000
const profileImageMimeTypes: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg'
}

export async function downloadProfileImage (url: string, userId: number, uploadDirectory: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(profileImageDownloadTimeout) })
  if (!response.ok || !response.body) {
    throw new Error('url returned a non-OK status code or an empty body')
  }

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  const extension = contentType ? profileImageMimeTypes[contentType] : undefined
  if (!extension) {
    throw new Error('url returned an unsupported profile image type')
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxProfileImageSize)) {
    throw new Error('url returned an oversized profile image')
  }

  const destination = path.join(uploadDirectory, `${userId}.${extension}`)
  const temporaryFile = `${destination}.${randomUUID()}.tmp`
  let receivedBytes = 0
  const sizeLimit = new Transform({
    transform (chunk, _encoding, callback) {
      receivedBytes += chunk.length
      callback(receivedBytes > maxProfileImageSize ? new Error('url returned an oversized profile image') : null, chunk)
    }
  })

  try {
    await pipeline(Readable.fromWeb(response.body as any), sizeLimit, fs.createWriteStream(temporaryFile, { flags: 'wx' }))
    await fs.promises.rename(temporaryFile, destination)
  } catch (error) {
    await fs.promises.rm(temporaryFile, { force: true })
    throw error
  }

  return `/assets/public/images/uploads/${userId}.${extension}`
}

export function profileImageUrlUpload () {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.body.imageUrl !== undefined) {
      const url = req.body.imageUrl
      if (url.match(/(.)*solve\/challenges\/server-side(.)*/) !== null) req.app.locals.abused_ssrf_bug = true
      const loggedInUser = security.authenticatedUsers.get(req.cookies.token)
      if (loggedInUser) {
        try {
          const profileImage = await downloadProfileImage(url, loggedInUser.data.id, 'frontend/dist/frontend/assets/public/images/uploads')
          const user = await UserModel.findByPk(loggedInUser.data.id)
          await user?.update({ profileImage })
        } catch (error) {
          try {
            const user = await UserModel.findByPk(loggedInUser.data.id)
            await user?.update({ profileImage: url })
            logger.warn(`Error retrieving user profile image: ${utils.getErrorMessage(error)}; using image link directly`)
          } catch (error) {
            next(error)
            return
          }
        }
      } else {
        next(new Error('Blocked illegal activity by ' + req.socket.remoteAddress))
        return
      }
    }
    res.location(process.env.BASE_PATH + '/profile')
    res.redirect(process.env.BASE_PATH + '/profile')
  }
}
