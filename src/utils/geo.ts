import { getDistance } from 'geolib';

export function geodistanceMeters(
	a: { latitude: number; longitude: number } | null | undefined,
	b: { latitude: number; longitude: number } | null | undefined,
): number | null {
	if (!a || !b) return null;
	if (
		a.latitude == null ||
		a.longitude == null ||
		b.latitude == null ||
		b.longitude == null
	) {
		return null;
	}
	return getDistance(
		{ latitude: a.latitude, longitude: a.longitude },
		{ latitude: b.latitude, longitude: b.longitude },
	);
}


