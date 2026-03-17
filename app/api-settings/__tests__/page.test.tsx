/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'

// ---------------------------------------------------------------------------
// Mock next/navigation (used indirectly via AuthGuard / Header)
// ---------------------------------------------------------------------------
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/api-settings',
}))

// Mock next/script — just renders nothing
jest.mock('next/script', () => () => null)

// Mock Header — we only care about the page's data-fetching behaviour
jest.mock('@/components/layout/Header', () => () => <div data-testid="header" />)

// Mock EXCHANGES — needed by buildDefaultAccounts() in the page
jest.mock('@/lib/mock-data', () => ({
  EXCHANGES: [
    {
      id: 'binance',
      name: 'Binance',
      color: '#F0B90B',
      subAccounts: [{ id: 'binance-alpha', name: 'Alpha Fund' }],
    },
  ],
}))

// Spy on localStorage to verify it is never read for accounts
const localStorageGetSpy = jest.spyOn(Storage.prototype, 'getItem')

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------
const mockFetch = jest.fn()
global.fetch = mockFetch

function makeGetResponse(accounts: unknown[]) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(accounts),
  } as Response)
}

function makePostResponse(account: unknown) {
  return Promise.resolve({
    ok: true,
    status: 201,
    json: () => Promise.resolve(account),
  } as Response)
}

function makeDeleteResponse() {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true }),
  } as Response)
}

function makeErrorResponse(status = 500) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'Server error' }),
  } as Response)
}

// ---------------------------------------------------------------------------
// Import the page (after all mocks are set up)
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ApiSettingsPage = () => require('../page').default

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('API Settings page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()    // clearAllMocks does NOT drain mockReturnValueOnce queues
    localStorageGetSpy.mockClear()
  })

  it('loads accounts from GET /api/accounts on mount', async () => {
    mockFetch.mockReturnValueOnce(
      makeGetResponse([
        { id: 'uuid-1', fund: 'Cicada Foundation', exchange: 'binance', account_name: 'Alpha Fund', instrument: 'spot', status: 'not_configured' },
      ]),
    )

    const Page = ApiSettingsPage()
    await act(async () => { render(<Page />) })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/accounts')
    })

    expect(await screen.findByText('Alpha Fund')).toBeInTheDocument()
  })

  it('shows empty state when no accounts exist', async () => {
    mockFetch.mockReturnValueOnce(makeGetResponse([]))

    const Page = ApiSettingsPage()
    await act(async () => { render(<Page />) })

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/accounts'))

    expect(screen.getByText(/no accounts/i)).toBeInTheDocument()
  })

  it('submits form to POST /api/accounts with correct fields', async () => {
    // Initial GET returns empty
    mockFetch.mockReturnValueOnce(makeGetResponse([]))
    // POST returns the created account
    mockFetch.mockReturnValueOnce(
      makePostResponse({ id: 'new-uuid', fund: 'Cicada Foundation', exchange: 'bybit', account_name: 'Test Account', instrument: 'futures' }),
    )
    // Subsequent GET after creation
    mockFetch.mockReturnValueOnce(
      makeGetResponse([{ id: 'new-uuid', fund: 'Cicada Foundation', exchange: 'bybit', account_name: 'Test Account', instrument: 'futures', status: 'not_configured' }]),
    )

    const Page = ApiSettingsPage()
    await act(async () => { render(<Page />) })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/accounts'))

    // Fill in the form
    fireEvent.change(screen.getByPlaceholderText('e.g. Alpha Fund'), { target: { value: 'Test Account' } })
    fireEvent.change(screen.getByDisplayValue('Choose exchange'), { target: { value: 'bybit' } })
    fireEvent.change(screen.getByPlaceholderText('Enter API key'), { target: { value: 'my-api-key' } })
    fireEvent.change(screen.getByPlaceholderText('Enter secret key'), { target: { value: 'my-secret' } })

    // Submit — use role to disambiguate from the <p> heading that also says "Create Account"
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(([url, opts]) => url === '/api/accounts' && opts?.method === 'POST')
      expect(postCall).toBeDefined()
      const body = JSON.parse(postCall![1].body)
      expect(body.account_name).toBe('Test Account')
      expect(body.exchange).toBe('bybit')
      expect(body.api_key).toBe('my-api-key')
      expect(body.api_secret).toBe('my-secret')
    })
  })

  it('removes account via DELETE /api/accounts/[id] on Remove click', async () => {
    mockFetch.mockReturnValueOnce(
      makeGetResponse([
        { id: 'uuid-to-delete', fund: 'Cicada Foundation', exchange: 'binance', account_name: 'Alpha Fund', instrument: 'spot', status: 'not_configured' },
      ]),
    )
    mockFetch.mockReturnValueOnce(makeDeleteResponse())
    mockFetch.mockReturnValueOnce(makeGetResponse([]))

    const Page = ApiSettingsPage()
    await act(async () => { render(<Page />) })
    await screen.findByText('Alpha Fund')

    fireEvent.click(screen.getByText('Remove'))

    await waitFor(() => {
      const deleteCall = mockFetch.mock.calls.find(
        ([url, opts]) => url === '/api/accounts/uuid-to-delete' && opts?.method === 'DELETE',
      )
      expect(deleteCall).toBeDefined()
    })
  })

  it('shows loading state while fetching', async () => {
    // Never resolves — stays in loading state
    mockFetch.mockReturnValueOnce(new Promise(() => {}))

    const Page = ApiSettingsPage()
    render(<Page />)

    expect(screen.getByTestId('accounts-loading')).toBeInTheDocument()
  })

  it('shows error state if fetch fails', async () => {
    mockFetch.mockReturnValueOnce(makeErrorResponse(500))

    const Page = ApiSettingsPage()
    render(<Page />)

    expect(await screen.findByTestId('accounts-error')).toBeInTheDocument()
  })

  it('never reads from localStorage for accounts', async () => {
    mockFetch.mockReturnValueOnce(makeGetResponse([]))

    const Page = ApiSettingsPage()
    await act(async () => { render(<Page />) })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/accounts'))

    // localStorage.getItem should never be called with the accounts key
    const accountsKeyRead = localStorageGetSpy.mock.calls.some(
      ([k]) => k === 'cicada:accounts',
    )
    expect(accountsKeyRead).toBe(false)
  })
})
