# Third-party notices

## EasyList Cookie List

`extension/cookie-rules.json` and `extension/rules/cookie-scripts.json` are converted from the
[EasyList Cookie List](https://easylist.to) (source: <https://github.com/easylist/easylist>) by
`tools/build_cookie_rules.py`. They contain a subset of the list's rules, reformatted for Safari.

The list is © the EasyList authors (<https://easylist.to/>).

Its licence is stated in two places that don't quite agree:

- The list's own header names Creative Commons Attribution 3.0
  (<https://creativecommons.org/licenses/by/3.0/>), checked on 2026-11-04.
- EasyList's licence page (<https://easylist.to/pages/licence.html>) says the repository is dual licensed
  under the GNU General Public License version 3 or later, and Creative Commons Attribution-ShareAlike 3.0
  Unported or later, at your option.

To respect both, Cookie Munch takes the stricter reading: the two converted rule files are shared under
**Creative Commons Attribution-ShareAlike 3.0** (<https://creativecommons.org/licenses/by-sa/3.0/>), with
attribution to the EasyList authors. Any changes made in converting them are released under the same terms.
This applies only to those two files. The rest of Cookie Munch is under the MIT licence in `LICENSE`.

## Fanboy's Newsletter List and Fanboy's Notifications List

`extension/rules/other-popups.json`, used by "Also hide other popups", is converted from EasyList's
[Fanboy's Newsletter List](https://secure.fanboy.co.nz/fanboy-newsletter.txt) and
[Fanboy's Notifications List](https://secure.fanboy.co.nz/fanboy-notifications.txt) (<https://easylist.to>,
source: <https://github.com/easylist/easylist>) by `tools/build_cookie_rules.py`. It contains a subset of
the two lists' rules, reformatted for Safari.

The lists are © the EasyList authors (<https://easylist.to/>). Their headers name Creative Commons
Attribution 3.0 (checked on 2026-11-24), and EasyList's licence page gives the dual licence described above;
Cookie Munch takes the same stricter reading: `extension/rules/other-popups.json` is shared under
**Creative Commons Attribution-ShareAlike 3.0**, with attribution to the EasyList authors, and any changes
made in converting it are released under the same terms.
