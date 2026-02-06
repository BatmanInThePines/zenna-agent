'use client';

import { useState, useEffect, useCallback } from 'react';

interface GeolocationPromptProps {
  onLocationGranted: (location: { latitude: number; longitude: number; city?: string; region?: string; country?: string }) => void;
  onLocationDenied: () => void;
}

/**
 * GeolocationPrompt - Asks user for location permission with clear explanation
 *
 * Shows a friendly modal explaining why Zen-na needs location access:
 * - Weather information
 * - Local news and events
 * - Time zone awareness
 * - Place-based context (home vs work)
 */
export default function GeolocationPrompt({ onLocationGranted, onLocationDenied }: GeolocationPromptProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if we should show the prompt (only if permission not already granted/denied)
  useEffect(() => {
    const checkPermission = async () => {
      // Check if we've already asked (stored in localStorage)
      const hasAsked = localStorage.getItem('zenna_geolocation_asked');
      if (hasAsked) {
        // If previously granted, try to get location silently
        if (hasAsked === 'granted') {
          try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false,
                timeout: 5000,
                maximumAge: 300000, // 5 minutes cache
              });
            });

            // Reverse geocode to get city name
            const locationData = await reverseGeocode(position.coords.latitude, position.coords.longitude);
            onLocationGranted(locationData);
          } catch {
            // Permission may have been revoked, show prompt again
            localStorage.removeItem('zenna_geolocation_asked');
            setIsVisible(true);
          }
        }
        return;
      }

      // Check browser permission status if available
      if ('permissions' in navigator) {
        try {
          const result = await navigator.permissions.query({ name: 'geolocation' });
          if (result.state === 'granted') {
            // Already granted, get location
            localStorage.setItem('zenna_geolocation_asked', 'granted');
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject);
            });
            const locationData = await reverseGeocode(position.coords.latitude, position.coords.longitude);
            onLocationGranted(locationData);
            return;
          } else if (result.state === 'denied') {
            // Already denied, don't show prompt
            localStorage.setItem('zenna_geolocation_asked', 'denied');
            onLocationDenied();
            return;
          }
        } catch {
          // Permission API not available, show prompt
        }
      }

      // Show the prompt
      setIsVisible(true);
    };

    checkPermission();
  }, [onLocationGranted, onLocationDenied]);

  // Reverse geocode coordinates to get city/region/country
  const reverseGeocode = async (latitude: number, longitude: number) => {
    try {
      // Use a free reverse geocoding service
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10`,
        {
          headers: {
            'User-Agent': 'Zenna-AI-Assistant/1.0',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        return {
          latitude,
          longitude,
          city: data.address?.city || data.address?.town || data.address?.village || data.address?.municipality,
          region: data.address?.state || data.address?.province,
          country: data.address?.country,
        };
      }
    } catch (err) {
      console.warn('Reverse geocoding failed:', err);
    }

    // Return just coordinates if geocoding fails
    return { latitude, longitude };
  };

  // Handle user granting permission
  const handleAllow = useCallback(async () => {
    setIsRequesting(true);
    setError(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 300000,
        });
      });

      localStorage.setItem('zenna_geolocation_asked', 'granted');

      // Get city name from coordinates
      const locationData = await reverseGeocode(position.coords.latitude, position.coords.longitude);

      setIsVisible(false);
      onLocationGranted(locationData);
    } catch (err) {
      const geoError = err as GeolocationPositionError;
      if (geoError.code === geoError.PERMISSION_DENIED) {
        setError('Location access was denied. You can enable it later in your browser settings.');
        localStorage.setItem('zenna_geolocation_asked', 'denied');
        setTimeout(() => {
          setIsVisible(false);
          onLocationDenied();
        }, 3000);
      } else if (geoError.code === geoError.POSITION_UNAVAILABLE) {
        setError('Unable to determine your location. Please try again later.');
      } else if (geoError.code === geoError.TIMEOUT) {
        setError('Location request timed out. Please try again.');
      }
      setIsRequesting(false);
    }
  }, [onLocationGranted, onLocationDenied]);

  // Handle user denying permission
  const handleDeny = useCallback(() => {
    localStorage.setItem('zenna_geolocation_asked', 'denied');
    setIsVisible(false);
    onLocationDenied();
  }, [onLocationDenied]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zenna-surface border border-zenna-border rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-300">
        {/* Location Icon */}
        <div className="text-center mb-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zenna-accent/20 mb-2">
            <svg className="w-8 h-8 text-zenna-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-medium text-center mb-3">
          Enable Location for Zen-na?
        </h2>

        {/* Explanation */}
        <div className="text-zenna-muted text-sm mb-6 space-y-3">
          <p className="text-center">
            Sharing your location helps Zen-na provide personalized, relevant information:
          </p>

          <ul className="space-y-2 pl-2">
            <li className="flex items-start gap-2">
              <span className="text-lg">🌤️</span>
              <span><strong>Weather</strong> - Current conditions and forecasts for your area</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-lg">📰</span>
              <span><strong>Local News</strong> - Stories and events happening near you</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-lg">🕐</span>
              <span><strong>Time</strong> - Accurate local time and timezone awareness</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-lg">🏠</span>
              <span><strong>Place Context</strong> - As Zen-na learns your places (home, work), curated conversations based on where you are</span>
            </li>
          </ul>

          <p className="text-center text-xs text-zenna-muted/70 pt-2">
            Your location is stored securely and only used to enhance your experience.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleDeny}
            disabled={isRequesting}
            className="flex-1 px-4 py-3 border border-zenna-border rounded-xl hover:bg-zenna-border/50 transition-colors disabled:opacity-50"
          >
            Not Now
          </button>
          <button
            onClick={handleAllow}
            disabled={isRequesting}
            className="flex-1 px-4 py-3 bg-zenna-accent hover:bg-indigo-600 rounded-xl transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isRequesting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Locating...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Allow Location</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
