import { encrypt } from '../crypto/encrypt'
import { decrypt } from '../crypto/decrypt'

// 32-byte key expressed as 64 hex chars
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY
})

afterEach(() => {
  delete process.env.ENCRYPTION_KEY
})

// ---------------------------------------------------------------------------
// encrypt
// ---------------------------------------------------------------------------
describe('encrypt', () => {
  it('returns a non-empty string different from input', () => {
    const result = encrypt('my secret api key')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).not.toBe('my secret api key')
  })

  it('returns different ciphertext each call (IV randomness)', () => {
    const a = encrypt('same plaintext')
    const b = encrypt('same plaintext')
    expect(a).not.toBe(b)
  })

  it('throws if ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY
    expect(() => encrypt('test')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// decrypt
// ---------------------------------------------------------------------------
describe('decrypt', () => {
  it('decrypt(encrypt(text)) returns original text', () => {
    const original = 'super-secret-api-key-12345'
    expect(decrypt(encrypt(original))).toBe(original)
  })

  it('throws if ciphertext is tampered with', () => {
    const ciphertext = encrypt('secret')
    // Flip the last character to corrupt the auth tag
    const last = ciphertext[ciphertext.length - 1]
    const tampered = ciphertext.slice(0, -1) + (last === 'a' ? 'b' : 'a')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('throws if ENCRYPTION_KEY is missing', () => {
    const ciphertext = encrypt('test')
    delete process.env.ENCRYPTION_KEY
    expect(() => decrypt(ciphertext)).toThrow()
  })
})
