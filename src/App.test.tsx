import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App.tsx'

beforeEach(() => {
  localStorage.clear()
})

describe('App', () => {
  it('renders the app heading and starts on the box screen', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'AI Chocolation' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pick a box size' })).toBeInTheDocument()
  })

  it('switches to the records screen', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Records' }))
    expect(screen.getByText('No boxes saved yet.')).toBeInTheDocument()
  })

  it('demo mode fills in records and stats, then clears them back out', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Demo mode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Records' }))
    expect(screen.getByText(/Saved boxes \(24\)/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Demo mode' }))
    expect(screen.getByText(/Saved boxes \(0\)/)).toBeInTheDocument()
  })
})
