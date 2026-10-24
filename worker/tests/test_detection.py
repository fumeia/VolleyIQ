import numpy as np

from volleyiq_worker import audio, rallies

SR = audio.SR


def synth(duration, contacts, whistles=(), noise=0.003, seed=0):
    rng = np.random.default_rng(seed)
    x = rng.normal(0, noise, int(duration * SR)).astype(np.float32)
    for t in contacts:
        i = int(t * SR)
        n = int(0.012 * SR)
        x[i:i + n] += (rng.normal(0, 0.5, n) * np.exp(-np.arange(n) / (0.003 * SR))).astype(np.float32)
    for start, end in whistles:
        tt = np.arange(int((end - start) * SR)) / SR
        i = int(start * SR)
        x[i:i + len(tt)] += (0.2 * np.sin(2 * np.pi * 3200 * tt)).astype(np.float32)
    return x


def chunks(x, size=SR * 7):
    for i in range(0, len(x), size):
        yield x[i:i + size]


def test_contacts_and_whistles_are_found():
    contacts = [2.0, 3.4, 4.6, 5.5, 6.3, 20.0, 21.2, 22.5]
    x = synth(30, contacts, whistles=[(1.0, 1.5), (9.0, 9.6)])
    feat = audio.features_from_chunks(chunks(x))
    wh = audio.detect_whistles(feat)
    assert len(wh) == 2
    assert abs(wh[0][0] - 1.0) < 0.1
    found = [t for t, _ in audio.detect_contacts(feat, whistles=wh)]
    for t in contacts:
        assert any(abs(f - t) < 0.05 for f in found), (t, found)
    assert len(found) == len(contacts), found


def test_rally_segmentation_and_labels():
    contacts = [(2.0, 1), (3.4, 1), (4.6, 1), (5.5, 1), (6.3, 1), (7.0, 1), (20.0, 1), (21.2, 1)]
    rs = rallies.segment_rallies(contacts, whistles=[(10, 10.5)])
    assert len(rs) == 2
    rallies.label_rally(rs[0])
    assert [t.action for t in rs[0].touches] == ["serve", "receive", "set", "attack", "dig", "set"]
    assert [t.possession for t in rs[0].touches] == [0, 1, 1, 1, 2, 2]


def test_team_assignment_drops_opponent_possessions():
    r = rallies.segment_rallies([(0, 1), (1.2, 1), (2.3, 1), (3.1, 1), (3.6, 1)])[0]
    rallies.label_rally(r)
    # Serve read as #7 (on our roster) -> possession 0 and 2 are ours, possession 1 is theirs.
    r.touches[0].jersey, r.touches[0].jersey_conf = 7, 0.9
    rallies.assign_teams(r, {7, 9})
    assert [t.team for t in r.touches] == ["us", "them", "them", "them", "us"]
    events = rallies.to_events([r])
    assert [e["action"] for e in events] == ["serve", "dig"]
    assert events[0]["jersey"] == 7
