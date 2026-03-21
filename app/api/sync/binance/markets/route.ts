import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import * as ccxt from 'ccxt'

const CHUNK_SIZE = 50

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const exchange = new ccxt.binance()
    const markets = await exchange.loadMarkets()

    const symbols = Object.values(markets)
      .filter((m): m is NonNullable<typeof m> => m != null && m.quote === 'USDT')
      .map((m) => m.symbol)

    const totalSymbols = symbols.length
    const totalChunks = totalSymbols === 0 ? 0 : Math.ceil(totalSymbols / CHUNK_SIZE)

    return NextResponse.json({ totalChunks, chunkSize: CHUNK_SIZE, totalSymbols })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
